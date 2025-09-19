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

function createDateFolder() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  
  const folderPath = path.join(__dirname, 'accounts', year.toString(), month.toString(), day.toString());
  
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
    console.log(`${getColor("cyan")}[FOLDER]${getColor("white")} フォルダ作成: ${folderPath}`);
  }
  
  return folderPath;
}

const STORAGE_MODE = process.env.STORAGE_MODE || "json"; 

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

async function initializeCredentials() {
  if (token && cookie) {
    console.log(`${getColor("green")}[INFO]${getColor("white")} 環境変数から認証情報を読み込みました`);
    
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

function updateCookie(newCookie) {
  if (newCookie && newCookie.includes('=') && newCookie.length > 10) {
    process.env.COOKIE = newCookie;
    console.log(`${getColor("green")}[INFO]${getColor("white")} クッキーが更新されました`);
    return true;
  }
  console.log(`${getColor("red")}[ERROR]${getColor("white")} 無効なクッキー形式です`);
  return false;
}

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

const PERFORMANCE_CONFIG = {
  numAccountsToCreate: 10000,
  maxConcurrentAccounts: 5,
  batchSize: 50,
  retryAttempts: 2,
  timeoutMs: 30000,
  delayBetweenBatches: 2000,
  delayBetweenRequests: 3000,
};

const BAN_PREVENTION_CONFIG = {
  enablePosting: true,
  maxPosts: 15,
};

let successCount = 0;
let failureCount = 0;
let startTime = Date.now();

let isRateLimited = false;
let rateLimitEndTime = 0;

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

function setRateLimit(seconds) {
  isRateLimited = true;
  rateLimitEndTime = Date.now() + (seconds * 1000) + 2000;
  console.log(`${getColor("red")}[RATE_LIMIT]${getColor("white")} レート制限検知: ${seconds}秒 + 2秒の待機を設定`);
}

async function createAccount() {
  const { numAccountsToCreate, maxConcurrentAccounts, batchSize } = PERFORMANCE_CONFIG;
  
  const dateFolder = createDateFolder();
  const outputPath = path.join(dateFolder, "ACCOUNT.JSON");

  if (STORAGE_MODE === "json" && !fs.existsSync(outputPath)) {
    fs.writeFileSync(outputPath, JSON.stringify([]), "utf-8");
  }

  console.log(`${getColor("cyan")}[INFO]${getColor("white")} アカウント作成を開始します...`);
  console.log(`${getColor("cyan")}[INFO]${getColor("white")} 同時実行数: ${maxConcurrentAccounts}, バッチサイズ: ${batchSize}`);

  let completedCount = 0;
  let runningTasks = 0;
  
  async function startTask() {
    if (completedCount >= numAccountsToCreate) return;
    
    await waitForRateLimit();
    
    runningTasks++;
    try {
      await handleAccountCreationWithRetry(outputPath);
    } catch (error) {
      if (error.message && error.message.includes('Rate limit exceeded')) {
        const match = error.message.match(/Wait (\d+) seconds/);
        if (match) {
          setRateLimit(parseInt(match[1]));
        }
      }
    } finally {
      runningTasks--;
      completedCount++;
      
      if (completedCount % 5 === 0 || completedCount === numAccountsToCreate) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = successCount / elapsed;
        const userStats = getUsedUserStats();
        console.log(`${getColor("green")}[PROGRESS]${getColor("white")} 進行: ${completedCount}/${numAccountsToCreate}, 成功: ${successCount}, 失敗: ${failureCount}, 速度: ${rate.toFixed(2)}/秒`);
        console.log(`${getColor("cyan")}[USERS]${getColor("white")} 使用済み: ${userStats.usedCount}, キャッシュ: ${userStats.cacheSize}件`);
      }
      
      if (completedCount < numAccountsToCreate) {
        setTimeout(() => startTask(), PERFORMANCE_CONFIG.delayBetweenRequests);
      }
    }
  }

  const initialTasks = Math.min(maxConcurrentAccounts, numAccountsToCreate);
  for (let i = 0; i < initialTasks; i++) {
    startTask();
  }

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
        const existingData = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
        existingData.push(account);
        fs.writeFileSync(outputPath, JSON.stringify(existingData, null, 2), "utf-8");
        
        console.log(`${getColor("green")}[SUCCESS]${getColor("white")} ACCOUNT.JSON保存: ${email}`);
      } else if (STORAGE_MODE === "mongodb") {
        const bot = new Bot(account);
        await bot.save();
        console.log(`${getColor("green")}[SUCCESS]${getColor("white")} MongoDB保存: ${email}`);
      }
      
      if (BAN_PREVENTION_CONFIG.enablePosting) {
        try {
          console.log(`${getColor("cyan")}[BAN_PREVENTION]${getColor("white")} BAN対策投稿を開始します...`);
          
          const timelinePosts = random_user_info?.timelinePosts || [];
          await copyUserPosts(
            timelinePosts,
            access_token,
            uuid,
            BAN_PREVENTION_CONFIG.maxPosts,
            { ...random_user_info, email }
          );
          
          console.log(`${getColor("green")}[BAN_PREVENTION]${getColor("white")} BAN対策投稿完了: ${email}`);
        } catch (banError) {
          console.error(`${getColor("red")}[BAN_PREVENTION]${getColor("white")} BAN対策投稿に失敗: ${banError.message}`);
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

(async () => {
    try {
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

