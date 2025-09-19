require('dotenv').config();
const fs = require("fs");
const path = require("path");
const { v4: generateUUID } = require('uuid');
const TempGmail = require("./TempGmail");
const mongoose = require('mongoose');

const {
  get_email_verification_urls,
  post_email_verification_url,
  get_email_grant_tokens,
  generate_password,
  register,
  getUsedUserStats
} = require("./utils/api-enhanced");

const { copyUserPosts } = require("./utils/api");
const { getColor } = require('./utils/color');

// 日付ベースのフォルダ構造を作成する関数
function createDateFolder() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 0ベースなので+1
  const day = now.getDate();
  
  // accounts/年/月/日/ の構造でフォルダを作成
  const folderPath = path.join(__dirname, 'accounts', year.toString(), month.toString(), day.toString());
  
  // フォルダが存在しない場合は作成
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
    console.log(`${getColor("cyan")}[FOLDER]${getColor("white")} フォルダ作成: ${folderPath}`);
  }
  
  return folderPath;
}

// 保存先切り替え: "json" または "mongodb"
const STORAGE_MODE = process.env.STORAGE_MODE || "json"; 

// MongoDB設定
let Bot;
if (STORAGE_MODE === "mongodb") {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => {
      console.error('MongoDB connection error:', err);
      process.exit(1);
    });

  const botSchema = new mongoose.Schema({
    email: String,
    password: String,
    user_id: String,
    uuid: String,
    access_token: String,
    refresh_token: String,
  });
  Bot = mongoose.model('rinapen', botSchema);
}

const token = process.env.XSRF_TOKEN;
const cookie = process.env.COOKIE;

// 認証情報の初期化（自動生成対応）
async function initializeCredentials() {
  // 環境変数でトークンとクッキーが設定されている場合はそれを使用
  if (token && cookie) {
    console.log(`${getColor("green")}[INFO]${getColor("white")} 環境変数から認証情報を読み込みました`);
    
    // クッキーの基本的な形式チェック
    if (!cookie.includes('=') || cookie.length < 10) {
      console.log(`${getColor("red")}[CRITICAL]${getColor("white")} COOKIEの形式が無効です。`);
      console.log(`${getColor("red")}[CRITICAL]${getColor("white")} 正しいクッキー形式を設定するか、自動生成を使用してください。`);
      process.exit(1);
    }
    
    return { token, cookie };
  } else {
    console.log(`${getColor("cyan")}[INFO]${getColor("white")} 環境変数に認証情報が設定されていません。自動生成を使用します。`);
    return { token: null, cookie: null };
  }
}

// クッキーの動的更新機能（将来の拡張用）
function updateCookie(newCookie) {
  if (newCookie && newCookie.includes('=') && newCookie.length > 10) {
    process.env.COOKIE = newCookie;
    console.log(`${getColor("green")}[INFO]${getColor("white")} クッキーが更新されました`);
    return true;
  }
  console.log(`${getColor("red")}[ERROR]${getColor("white")} 無効なクッキー形式です`);
  return false;
}

// 認証情報の有効性をテストする機能
async function testCredentialsValidity(credentials) {
  try {
    const tempGmail = new TempGmail(credentials.token, credentials.cookie);
    const testEmail = await tempGmail.generateGmail();
    if (testEmail) {
      console.log(`${getColor("green")}[INFO]${getColor("white")} 認証情報の有効性確認完了`);
      return true;
    }
  } catch (error) {
    console.log(`${getColor("red")}[ERROR]${getColor("white")} 認証情報の有効性確認失敗: ${error.message}`);
  }
  return false;
}

// パフォーマンス設定
const PERFORMANCE_CONFIG = {
  numAccountsToCreate: 10000, // テスト用に少なく設定
  maxConcurrentAccounts: 5, // レート制限対策で同時実行数を1に削減
  batchSize: 50, // バッチ処理サイズを増加
  retryAttempts: 2, // リトライ回数を2回に設定
  timeoutMs: 30000, // タイムアウト時間を短縮（30秒）
  delayBetweenBatches: 2000, // バッチ間の遅延を増加（レート制限対策）
  delayBetweenRequests: 3000, // リクエスト間の遅延を3秒に増加（レート制限対策）
};

// BAN対策設定
const BAN_PREVENTION_CONFIG = {
  enablePosting: true, // BAN対策投稿を有効にする
  maxPosts: 15, // コピーする投稿数
};

// 成功・失敗カウンター
let successCount = 0;
let failureCount = 0;
let startTime = Date.now();

// レート制限管理
let isRateLimited = false;
let rateLimitEndTime = 0;

// レート制限チェック関数
async function waitForRateLimit() {
  if (isRateLimited) {
    const waitTime = rateLimitEndTime - Date.now();
    if (waitTime > 0) {
      console.log(`${getColor("yellow")}[RATE_LIMIT]${getColor("white")} グローバル待機中... 残り${Math.ceil(waitTime/1000)}秒`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    isRateLimited = false;
  }
}

// レート制限を設定する関数
function setRateLimit(seconds) {
  isRateLimited = true;
  rateLimitEndTime = Date.now() + (seconds * 1000) + 2000; // 少し余裕を持たせる
  console.log(`${getColor("red")}[RATE_LIMIT]${getColor("white")} レート制限検知: ${seconds}秒 + 2秒の待機を設定`);
}

async function createAccount() {
  const { numAccountsToCreate, maxConcurrentAccounts, batchSize } = PERFORMANCE_CONFIG;
  
  // 日付ベースのフォルダを作成
  const dateFolder = createDateFolder();
  const outputPath = path.join(dateFolder, "ACCOUNT.JSON");

  if (STORAGE_MODE === "json" && !fs.existsSync(outputPath)) {
    fs.writeFileSync(outputPath, JSON.stringify([]), "utf-8");
  }

  console.log(`${getColor("cyan")}[INFO]${getColor("white")} アカウント作成を開始します...`);
  console.log(`${getColor("cyan")}[INFO]${getColor("white")} 同時実行数: ${maxConcurrentAccounts}, バッチサイズ: ${batchSize}`);

  // 効率的な並列処理でアカウント作成
  let completedCount = 0;
  let runningTasks = 0;
  
  async function startTask() {
    if (completedCount >= numAccountsToCreate) return;
    
    // レート制限チェック
    await waitForRateLimit();
    
    runningTasks++;
    try {
      await handleAccountCreationWithRetry(outputPath);
    } catch (error) {
      // レート制限エラーをチェック
      if (error.message && error.message.includes('Rate limit exceeded')) {
        const match = error.message.match(/Wait (\d+) seconds/);
        if (match) {
          setRateLimit(parseInt(match[1]));
        }
      }
      // エラーが発生してもログは既に出力されているので継続
    } finally {
      runningTasks--;
      completedCount++;
      
      // 進捗表示
      if (completedCount % 5 === 0 || completedCount === numAccountsToCreate) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = successCount / elapsed;
        const userStats = getUsedUserStats();
        console.log(`${getColor("green")}[PROGRESS]${getColor("white")} 進行: ${completedCount}/${numAccountsToCreate}, 成功: ${successCount}, 失敗: ${failureCount}, 速度: ${rate.toFixed(2)}/秒`);
        console.log(`${getColor("cyan")}[USERS]${getColor("white")} 使用済み: ${userStats.usedCount}, キャッシュ: ${userStats.cacheSize}件`);
      }
      
      // 新しいタスクを開始（レート制限対策で遅延を追加）
      if (completedCount < numAccountsToCreate) {
        setTimeout(() => startTask(), PERFORMANCE_CONFIG.delayBetweenRequests);
      }
    }
  }

  // 初期タスクを開始
  const initialTasks = Math.min(maxConcurrentAccounts, numAccountsToCreate);
  for (let i = 0; i < initialTasks; i++) {
    startTask();
  }

  // すべてのタスクの完了を待つ
  while (completedCount < numAccountsToCreate || runningTasks > 0) {
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`${getColor("green")}[SUCCESS]${getColor("white")} ${successCount}個のアカウントが作成されました。`);
  console.log(`${getColor("cyan")}[STATS]${getColor("white")} 総時間: ${totalTime.toFixed(2)}秒, 平均速度: ${(successCount/totalTime).toFixed(2)}/秒`);
}

async function handleAccountCreationWithRetry(outputPath) {
  const { retryAttempts } = PERFORMANCE_CONFIG;
  
  console.log(`${getColor("cyan")}[DEBUG]${getColor("white")} アカウント作成開始`);
  
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      console.log(`${getColor("cyan")}[DEBUG]${getColor("white")} 試行 ${attempt}/${retryAttempts}`);
      const result = await handleAccountCreation(outputPath);
      if (result) {
        successCount++;
        console.log(`${getColor("green")}[DEBUG]${getColor("white")} アカウント作成成功`);
        return result;
      }
    } catch (error) {
      if (attempt === retryAttempts) {
        failureCount++;
        console.error(`${getColor("red")}[RETRY_FAILED]${getColor("white")} 最大リトライ回数に達しました: ${error.message}`);
      } else {
        console.warn(`${getColor("yellow")}[RETRY]${getColor("white")} リトライ ${attempt}/${retryAttempts}: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // 指数バックオフ
      }
    }
  }
  console.log(`${getColor("red")}[DEBUG]${getColor("white")} アカウント作成失敗`);
  return null;
}

async function handleAccountCreation(outputPath) {
  let email;
  try {
    const tempGmail = new TempGmail(); // 自動生成を使用
    email = await tempGmail.generateGmail();
    if (!email) throw new Error(`Gmailが生成されませんでした。`);

    console.log(`${getColor("green")}[SUCCESS]${getColor("white")} Gmail生成: [${email}]`);

    // タイムアウト時間を延長
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("タイムアウト")), PERFORMANCE_CONFIG.timeoutMs)
    );
    
    let emailVerificationUrl;
    try {
      emailVerificationUrl = await Promise.race([get_email_verification_urls(email), timeout]);
    } catch (error) {
      throw new Error(`認証URL取得失敗: ${error.message}`);
    }

            if (!emailVerificationUrl) {
      throw new Error(`Gmailの認証に失敗しました。`);
            }

    console.log(`${getColor("green")}[SUCCESS]${getColor("white")} 認証URL取得: [${email}]`);

    await post_email_verification_url(emailVerificationUrl, email);
    
    const messageIDResult = await tempGmail.setMessageID();
    if (!messageIDResult) {
      throw new Error(`メール受信に失敗しました。`);
    }

    const authCode = await tempGmail.getTempAuthCode();
    if (!authCode) throw new Error(`認証コードが取得できませんでした。`);

    console.log(`${getColor("green")}[SUCCESS]${getColor("white")} 認証コード取得: [${email}]`);

    const emailGrantToken = await get_email_grant_tokens(email, authCode);
    if (!emailGrantToken) throw new Error(`email_grant_tokenの取得に失敗しました。`);

    console.log(`${getColor("green")}[SUCCESS]${getColor("white")} email_grant_token取得: [${email}]`);

    const password = generate_password();
    const uuid = generateUUID();
    const accountData = await register(email, password, emailGrantToken, uuid);

    if (accountData && accountData.id) {
      const { id, access_token, refresh_token, random_user_info } = accountData;
      const account = {
        email,
        password,
        user_id: id,
        uuid,
        access_token,
        refresh_token,
      };

      if (STORAGE_MODE === "json") {
        // メインのACCOUNT.JSONに追加
        const existingData = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
        existingData.push(account);
        fs.writeFileSync(outputPath, JSON.stringify(existingData, null, 2), "utf-8");
        
        console.log(`${getColor("green")}[SUCCESS]${getColor("white")} ACCOUNT.JSON保存: ${email}`);
      } else if (STORAGE_MODE === "mongodb") {
        const bot = new Bot(account);
        await bot.save();
        console.log(`${getColor("green")}[SUCCESS]${getColor("white")} MongoDB保存: ${email}`);
      }
      
      // BAN対策: アカウント作成後に投稿をコピー
      if (BAN_PREVENTION_CONFIG.enablePosting) {
        try {
          console.log(`${getColor("cyan")}[BAN_PREVENTION]${getColor("white")} BAN対策投稿を開始します...`);
          
          // 投稿をコピー（タイムライン情報を使用）
          const timelinePosts = random_user_info?.timelinePosts || [];
          await copyUserPosts(
            timelinePosts,
            access_token,
            uuid,
            BAN_PREVENTION_CONFIG.maxPosts,
            { ...random_user_info, email } // アカウント作成時の情報とemailを渡す
          );
          
          console.log(`${getColor("green")}[BAN_PREVENTION]${getColor("white")} BAN対策投稿完了: ${email}`);
        } catch (banError) {
          console.error(`${getColor("red")}[BAN_PREVENTION]${getColor("white")} BAN対策投稿に失敗: ${banError.message}`);
          // BAN対策が失敗してもアカウント作成は成功として扱う
        }
      }
      
      return account;
    } else {
      throw new Error(`アカウント情報の保存に失敗しました。`);
    }
  } catch (err) {
    console.error(`${getColor("red")}[ERROR]${getColor("white")} [${email || "unknown"}]: ${err.message}`);
    throw err;
    }
}

// メイン実行
(async () => {
    try {
    // 認証情報の初期化
    const credentials = await initializeCredentials();
    
    await createAccount();
    } catch (error) {
    console.error(`${getColor("red")}[FATAL]${getColor("white")} ${error.message}`);
  } finally {
    if (STORAGE_MODE === "mongodb") {
      await mongoose.connection.close();
    }
    }
})();

