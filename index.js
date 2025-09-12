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
const { getColor } = require('./utils/color');

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

// パフォーマンス設定
const PERFORMANCE_CONFIG = {
  numAccountsToCreate: 70000,
  maxConcurrentAccounts: 3, // 同時実行数を大幅に削減
  batchSize: 10, // バッチ処理サイズを削減
  retryAttempts: 3, // リトライ回数を増加
  timeoutMs: 30000, // タイムアウト時間を延長
  delayBetweenBatches: 5000, // バッチ間の遅延を増加
  delayBetweenRequests: 2000, // リクエスト間の遅延を追加
};

// 成功・失敗カウンター
let successCount = 0;
let failureCount = 0;
let startTime = Date.now();

async function createAccount() {
  const { numAccountsToCreate, maxConcurrentAccounts, batchSize } = PERFORMANCE_CONFIG;
  const outputPath = path.join(__dirname, "new_accounts.json");

  if (STORAGE_MODE === "json" && !fs.existsSync(outputPath)) {
    fs.writeFileSync(outputPath, JSON.stringify([]), "utf-8");
  }

  console.log(`${getColor("cyan")}[INFO]${getColor("white")} アカウント作成を開始します...`);
  console.log(`${getColor("cyan")}[INFO]${getColor("white")} 同時実行数: ${maxConcurrentAccounts}, バッチサイズ: ${batchSize}`);

  // バッチ処理でアカウント作成
  for (let batchStart = 0; batchStart < numAccountsToCreate; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, numAccountsToCreate);
    const currentBatchSize = batchEnd - batchStart;
    
    console.log(`${getColor("yellow")}[BATCH]${getColor("white")} バッチ ${Math.floor(batchStart/batchSize) + 1}/${Math.ceil(numAccountsToCreate/batchSize)} (${currentBatchSize}個)`);
    
    const batchPromises = [];
    
    for (let i = 0; i < currentBatchSize; i++) {
      batchPromises.push(handleAccountCreationWithRetry(outputPath));
      
      // リクエスト間の遅延を追加
      if (i < currentBatchSize - 1) {
        await new Promise(resolve => setTimeout(resolve, PERFORMANCE_CONFIG.delayBetweenRequests));
      }
      
      // 同時実行数制限
      if (batchPromises.length >= maxConcurrentAccounts) {
        await Promise.allSettled(batchPromises);
        batchPromises.length = 0;
      }
    }
    
    // 残りのプロミスを実行
    if (batchPromises.length > 0) {
      await Promise.allSettled(batchPromises);
    }
    
    // バッチ間の遅延
    if (batchEnd < numAccountsToCreate) {
      await new Promise(resolve => setTimeout(resolve, PERFORMANCE_CONFIG.delayBetweenBatches));
    }
    
    // 進捗表示
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = successCount / elapsed;
    const userStats = getUsedUserStats();
    console.log(`${getColor("green")}[PROGRESS]${getColor("white")} 成功: ${successCount}, 失敗: ${failureCount}, 速度: ${rate.toFixed(2)}/秒`);
    console.log(`${getColor("cyan")}[USERS]${getColor("white")} 使用済み: ${userStats.usedCount}, キャッシュ: ${userStats.cacheSize}件`);
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`${getColor("green")}[SUCCESS]${getColor("white")} ${successCount}個のアカウントが作成されました。`);
  console.log(`${getColor("cyan")}[STATS]${getColor("white")} 総時間: ${totalTime.toFixed(2)}秒, 平均速度: ${(successCount/totalTime).toFixed(2)}/秒`);
}

async function handleAccountCreationWithRetry(outputPath) {
  const { retryAttempts } = PERFORMANCE_CONFIG;
  
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      const result = await handleAccountCreation(outputPath);
      if (result) {
        successCount++;
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
  return null;
}

async function handleAccountCreation(outputPath) {
  let email;
  try {
    const tempGmail = new TempGmail(token, cookie);
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
      const { id, access_token, refresh_token } = accountData;
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
        console.log(`${getColor("green")}[SUCCESS]${getColor("white")} JSON保存: ${email}`);
      } else if (STORAGE_MODE === "mongodb") {
        const bot = new Bot(account);
        await bot.save();
        console.log(`${getColor("green")}[SUCCESS]${getColor("white")} MongoDB保存: ${email}`);
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
    await createAccount();
    } catch (error) {
    console.error(`${getColor("red")}[FATAL]${getColor("white")} ${error.message}`);
  } finally {
    if (STORAGE_MODE === "mongodb") {
      await mongoose.connection.close();
    }
    }
})();

