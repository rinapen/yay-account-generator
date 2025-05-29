require('dotenv').config();
const fs = require("fs");
const path = require("path");
const { v4: generateUUID } = require('uuid');
const TempGmail = require("./TempGmail");

const {
  get_email_verification_urls,
  post_email_verification_url,
  get_email_grant_tokens,
  generate_password,
  register
} = require("./utils/api");
const { getColor } = require('./utils/color');

const token = process.env.XSRF_TOKEN;
const cookie = process.env.COOKIE;

async function createAccount() {
  const numAccountsToCreate = 70000;
  const maxConcurrentAccounts = 5;
  const createPromises = [];
  const outputPath = path.join(__dirname, "accounts.json");

  if (!fs.existsSync(outputPath)) {
    fs.writeFileSync(outputPath, JSON.stringify([]), "utf-8");
  }

  for (let i = 0; i < numAccountsToCreate; i++) {
    createPromises.push(handleAccountCreation(outputPath));

    if (createPromises.length >= maxConcurrentAccounts) {
      await Promise.all(createPromises);
      createPromises.length = 0;
    }
  }

  if (createPromises.length > 0) {
    await Promise.all(createPromises);
  }

  console.log(`${getColor("green")}[success]: ${getColor("white")}${numAccountsToCreate}個のアカウントが作成されました。`);
}

async function handleAccountCreation(outputPath) {
  let email;
  try {
    const tempGmail = new TempGmail(token, cookie);
    email = await tempGmail.generateGmail();
    if (!email) throw new Error(`${getColor("red")}[error]: ${getColor("white")}Gmailが生成されませんでした。`);

    console.log(`${getColor("green")}[success]: ${getColor("white")}Gmailが生成されました。[${email}]`);

    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("タイムアウト")), 10000));
    let emailVerificationUrl;

    try {
      emailVerificationUrl = await Promise.race([get_email_verification_urls(email), timeout]);
    } catch (error) {
      console.error(`${getColor("red")}[${email}]: ${error.message}`);
      return;
    }

    if (!emailVerificationUrl) {
      console.error(`${getColor("red")}[error]: ${getColor("white")}Gmailの認証に失敗しました。[${email}]`);
      return;
    }

    console.log(`${getColor("green")}[success]: ${getColor("white")}認証URL取得に成功。[${email}]`);

    await post_email_verification_url(emailVerificationUrl, email);
    await tempGmail.setMessageID();

    const authCode = await tempGmail.getTempAuthCode();
    if (!authCode) throw new Error(`${getColor("red")}[error]: ${getColor("white")}認証コードが取得できませんでした。[${email}]`);

    console.log(`${getColor("green")}[success]: ${getColor("white")}認証コード取得に成功。[${email}]`);

    const emailGrantToken = await get_email_grant_tokens(email, authCode);
    if (!emailGrantToken) throw new Error(`${getColor("red")}[error]: ${getColor("white")}email_grant_tokenの取得に失敗しました。[${email}]`);

    console.log(`${getColor("green")}[success]: ${getColor("white")}email_grant_token取得に成功。[${email}]`);

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

      const existingData = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
      existingData.push(account);
      fs.writeFileSync(outputPath, JSON.stringify(existingData, null, 2), "utf-8");

      console.log(`${getColor("green")}[success]: ${getColor("white")}アカウント情報がJSONファイルに保存されました。${email}`);
    } else {
      throw new Error(`${getColor("red")}[error]: ${getColor("white")}アカウント情報の保存に失敗しました。${email}`);
    }
  } catch (err) {
    console.error(`[${email || "unknown"}]: ${err.message}`);
  }
}

(async () => {
  await createAccount();
})();