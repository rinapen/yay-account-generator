const fetch = require('node-fetch');
const { HttpsProxyAgent } = require("https-proxy-agent");
const fs = require('fs');
const path = require('path');
const { getColor } = require('./color');

const proxyUrl = process.env.PROXY_URL;

// トークンキャッシュファイルのパス
const TOKEN_CACHE_FILE = path.join(__dirname, '..', 'token-cache.json');

// 有効期限（30分 = 1800秒）
const TOKEN_EXPIRY_MINUTES = 30;

// メモリ内のトークンキャッシュ（プロセス実行中のみ有効）
let memoryCache = null;

// User-Agentを生成する関数
function generateUserAgent() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0'
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// キャッシュされたトークンを読み込む関数
function loadCachedToken() {
  try {
    if (!fs.existsSync(TOKEN_CACHE_FILE)) {
      return null;
    }
    
    const cacheData = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf-8'));
    const now = Date.now();
    const expiryTime = cacheData.timestamp + (TOKEN_EXPIRY_MINUTES * 60 * 1000);
    
    if (now < expiryTime) {
      console.log(`${getColor("green")}[CACHE]${getColor("white")} キャッシュされたトークンを使用します（残り${Math.round((expiryTime - now) / 60000)}分）`);
      return {
        token: cacheData.token,
        cookie: cacheData.cookie
      };
    } else {
      console.log(`${getColor("yellow")}[CACHE]${getColor("white")} キャッシュされたトークンが期限切れです`);
      return null;
    }
  } catch (error) {
    console.error(`${getColor("red")}[ERROR]${getColor("white")} キャッシュファイルの読み込みに失敗: ${error.message}`);
    return null;
  }
}

// トークンをキャッシュファイルに保存する関数
function saveCachedToken(token, cookie) {
  try {
    const cacheData = {
      token,
      cookie,
      timestamp: Date.now(),
      expiryMinutes: TOKEN_EXPIRY_MINUTES
    };
    
    fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf-8');
    console.log(`${getColor("green")}[CACHE]${getColor("white")} トークンをキャッシュしました（有効期限: ${TOKEN_EXPIRY_MINUTES}分）`);
  } catch (error) {
    console.error(`${getColor("red")}[ERROR]${getColor("white")} キャッシュファイルの保存に失敗: ${error.message}`);
  }
}

// キャッシュを考慮してトークンとクッキーを取得する関数
async function getTokenAndCookie() {
  // メモリキャッシュを最優先でチェック
  if (memoryCache) {
    const now = Date.now();
    const expiryTime = memoryCache.timestamp + (TOKEN_EXPIRY_MINUTES * 60 * 1000);
    
    if (now < expiryTime) {
      console.log(`${getColor("green")}[MEMORY]${getColor("white")} メモリキャッシュのトークンを使用します（残り${Math.round((expiryTime - now) / 60000)}分）`);
      return {
        token: memoryCache.token,
        cookie: memoryCache.cookie
      };
    } else {
      console.log(`${getColor("yellow")}[MEMORY]${getColor("white")} メモリキャッシュのトークンが期限切れです`);
      memoryCache = null;
    }
  }

  // ファイルキャッシュをチェック
  const cached = loadCachedToken();
  if (cached) {
    // メモリキャッシュに保存
    memoryCache = {
      token: cached.token,
      cookie: cached.cookie,
      timestamp: Date.now()
    };
    return cached;
  }

  // キャッシュが無効または存在しない場合は新規取得
  console.log(`${getColor("cyan")}[TOKEN]${getColor("white")} 新しいトークンとクッキーを取得します...`);
  const fresh = await getTokenAndCookieFresh();
  
  // メモリキャッシュに保存
  memoryCache = {
    token: fresh.token,
    cookie: fresh.cookie,
    timestamp: Date.now()
  };
  
  return fresh;
}

// 新しいトークンとクッキーを取得する関数
async function getTokenAndCookieFresh() {
  try {
    const url = "https://www.emailnator.com/";
    const headers = {
      "User-Agent": generateUserAgent(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "DNT": "1",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1"
    };

    const options = {
      method: 'GET',
      headers: headers
    };

    // プロキシが設定されている場合は使用
    if (proxyUrl) {
      options.agent = new HttpsProxyAgent(proxyUrl);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // クッキーを取得
    const setCookieHeader = response.headers.get('set-cookie');
    if (!setCookieHeader) {
      throw new Error('クッキーが取得できませんでした');
    }

    // クッキーをパース
    const cookies = {};
    setCookieHeader.split(',').forEach(cookie => {
      const [nameValue] = cookie.split(';');
      const [name, value] = nameValue.trim().split('=');
      if (name && value) {
        cookies[name] = value;
      }
    });

    // XSRF-TOKENを取得
    const xsrfToken = cookies['XSRF-TOKEN'];
    if (!xsrfToken) {
      throw new Error('XSRF-TOKENが取得できませんでした');
    }

    // トークンを適切な形式に変換（Pythonコードのロジックを参考）
    const token = xsrfToken.substring(0, 339) + "=";

    // クッキー文字列を生成
    const cookieString = Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');

    console.log(`${getColor("green")}[SUCCESS]${getColor("white")} トークンとクッキーを自動取得しました`);
    console.log(`${getColor("cyan")}[DEBUG]${getColor("white")} トークン: ${token.substring(0, 50)}...`);
    console.log(`${getColor("cyan")}[DEBUG]${getColor("white")} クッキー: ${cookieString.substring(0, 100)}...`);

    // キャッシュに保存
    saveCachedToken(token, cookieString);

    return { token, cookie: cookieString };

  } catch (error) {
    console.error(`${getColor("red")}[ERROR]${getColor("white")} トークンとクッキーの取得に失敗: ${error.message}`);
    throw error;
  }
}

// トークンとクッキーの有効性をテストする関数
async function testTokenAndCookie(token, cookie) {
  try {
    const url = "https://www.emailnator.com/generate-email";
    const headers = {
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": generateUserAgent(),
      "Content-Type": "application/json",
      "X-XSRF-TOKEN": token,
      "Cookie": cookie
    };

    const body = JSON.stringify({
      email: ['dotGmail', 'googleMail']
    });

    const options = {
      method: 'POST',
      headers: headers,
      body: body
    };

    if (proxyUrl) {
      options.agent = new HttpsProxyAgent(proxyUrl);
    }

    const response = await fetch(url, options);

    if (response.status === 419) {
      console.log(`${getColor("yellow")}[VALIDATION]${getColor("white")} トークンが期限切れです（419エラー）`);
      return false; // トークンが無効
    }

    if (!response.ok) {
      console.log(`${getColor("yellow")}[VALIDATION]${getColor("white")} バリデーションエラー: HTTP ${response.status}`);
      return false;
    }

    const data = await response.json();
    const isValid = data && data.email && Array.isArray(data.email) && data.email.length > 0;
    
    if (isValid) {
      console.log(`${getColor("green")}[VALIDATION]${getColor("white")} トークンの有効性確認完了`);
    }
    
    return isValid;

  } catch (error) {
    console.error(`${getColor("red")}[ERROR]${getColor("white")} トークンとクッキーのテストに失敗: ${error.message}`);
    return false;
  }
}

module.exports = {
  getTokenAndCookie,
  getTokenAndCookieFresh,
  testTokenAndCookie,
  generateUserAgent,
  loadCachedToken,
  saveCachedToken
};
