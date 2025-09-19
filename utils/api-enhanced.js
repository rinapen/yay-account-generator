const fetch = require('node-fetch');
const { v4: generateUUID } = require('uuid');
const { HttpsProxyAgent } = require('https-proxy-agent');
const APIClient = require('../APIClient');
const { faker, fakerJA } = require('@faker-js/faker');
const log = require('./log');

const proxyUrl = process.env.PROXY_URL;
const createAgent = () => proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
const device_uuid = generateUUID();

const API_CONFIG = {
  timeout: 15000,
  retryAttempts: 3,
  retryDelay: 1000,
  maxConcurrent: 20,
  rateLimit: {
    requests: 50,
    window: 60000
  }
};

let requestCount = 0;
let lastResetTime = Date.now();

const yayClient = new APIClient(
    process.env.YAY_API_HOST,
    process.env.USER_AGENT,
    device_uuid
);

function checkRateLimit() {
  const now = Date.now();
  if (now - lastResetTime >= API_CONFIG.rateLimit.window) {
    requestCount = 0;
    lastResetTime = now;
  }
  
  if (requestCount >= API_CONFIG.rateLimit.requests) {
    const waitTime = API_CONFIG.rateLimit.window - (now - lastResetTime);
    throw new Error(`Rate limit exceeded. Wait ${Math.ceil(waitTime / 1000)} seconds.`);
  }
  
  requestCount++;
}

async function retryApiCall(apiCall, maxRetries = API_CONFIG.retryAttempts) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      checkRateLimit();
      return await apiCall();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      const delay = API_CONFIG.retryDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      log.warn(`API call failed, retrying (${attempt}/${maxRetries}): ${error.message}`);
    }
  }
}

async function get_email_verification_urls(email) {
    return retryApiCall(async () => {
        const data = await yayClient.request('/v1/email_verification_urls', 'POST', {
            email,
            intent: 'sign_up',
            locale: 'ja',
            device_uuid: yayClient.headers['X-Device-UUID'],
        }, createAgent());
        log.success(`認証URL取得に成功。[${email}]`);
        return data.url;
    });
}

async function get_email_grant_tokens(email, code) {
    return retryApiCall(async () => {
        const client = new APIClient(
            'https://idcardcheck.com',
            yayClient.headers['User-Agent'],
            yayClient.headers['X-Device-UUID']
        );
        const data = await client.request('/apis/v1/apps/yay/email_grant_tokens', 'POST', { email, code });
        log.success(`email_grant_token取得に成功。[${email}]`);
        return data.email_grant_token;
    });
}

async function post_email_verification_url(email_verification_url, email) {
    return retryApiCall(async () => {
        const response = await fetch(email_verification_url, {
            method: 'POST',
            headers: yayClient.headers,
            body: JSON.stringify({ email, locale: 'ja' }),
            agent: createAgent()
        });

        const data = await response.json();
        if (data.status !== "success") {
            throw new Error(`Gmail verification failed for ${email}.`);
        } else {
            log.success(`Gmail verification successful for ${email}.`);
        }
    });
}

let usedUserIds = new Set();
let timelineCache = null;
let cacheExpiry = 0;
const CACHE_DURATION = 5 * 60 * 1000;
const MAX_RETRIES = 10;

async function get_random_user_info() {
    const now = Date.now();
    
    if (!timelineCache || now >= cacheExpiry) {
        try {
            const data = await yayClient.request('/v2/posts/timeline', "GET", null, createAgent());
            timelineCache = data.posts || [];
            cacheExpiry = now + CACHE_DURATION;
            log.debug(`Timeline cache updated: ${timelineCache.length} posts`);
        } catch (err) {
            log.error(`[get_random_user_info]: Failed to fetch timeline: ${err}`);
            return {
                nickname: getRandomJapaneseName(),
                biography: '',
                profile_icon: '',
                profile_icon_thumbnail: '',
                timelinePosts: []
            };
        }
    }
    
    let attempts = 0;
    while (attempts < MAX_RETRIES) {
        attempts++;
        
        const randomIndex = Math.floor(Math.random() * timelineCache.length);
        const user = timelineCache[randomIndex].user;
        
        if (user && user.id && !usedUserIds.has(user.id)) {
            usedUserIds.add(user.id);
            
            const userInfo = {
                nickname: user.nickname || getRandomJapaneseName(),
                biography: user.biography || '',
                profile_icon: user.profile_icon || '',
                profile_icon_thumbnail: user.profile_icon_thumbnail || '',
                user_id: user.id,
                timelinePosts: timelineCache
            };
            
            log.debug(`Selected new user: ${userInfo.nickname} (ID: ${user.id})`);
            return userInfo;
        }
        
        if (attempts >= timelineCache.length) {
            log.warn(`All users in current timeline have been used. Resetting cache and used IDs.`);
            timelineCache = null;
            usedUserIds.clear();
            cacheExpiry = 0;
            break;
        }
    }
    
    log.warn(`Could not find unused user after ${attempts} attempts. Using default values.`);
    return {
        nickname: getRandomJapaneseName(),
        biography: '',
        profile_icon: '',
        profile_icon_thumbnail: '',
        timelinePosts: timelineCache || []
    };
}

function getUsedUserStats() {
    return {
        usedCount: usedUserIds.size,
        cacheSize: timelineCache ? timelineCache.length : 0,
        cacheExpiry: new Date(cacheExpiry).toISOString()
    };
}

function getRandomJapaneseName() {
    const gender = Math.random() < 0.5 ? 'male' : 'female'; 
    return faker.person.firstName(gender);
}

async function register(email, password, email_grant_token, uuid) {
    return retryApiCall(async () => {
        if (!email_grant_token) {
            throw new Error(`email_grant_tokenが無効のためスキップ: ${email}`);
        }

        const random_user_info = await get_random_user_info();
        if (!random_user_info) {
            throw new Error(`Failed to get user info for ${email}.`);
        }

        log.info(`設定を開始します...\nユーザー名: [${random_user_info.nickname}]\n自己紹介: [${random_user_info.biography}]`);

        const profile_icon_filename = trim_url_prefix(random_user_info.profile_icon, "https://cdn.yay.space/uploads/");
        const device_uuid = yayClient.headers['X-Device-UUID'];
        const birthday = random_birthday();
        const gender = random_gender();
        const signed_info = generate_signed_info();
        const timestamp = Date.now();
        const api_key = process.env.API_KEY;
        const signed_version = process.env.SIGNED_INFO;

        const response = await yayClient.request('/v3/users/register', 'POST', {
            profile_icon_filename: profile_icon_filename || '',
            password,
            nickname: random_user_info.nickname,
            prefecture: '',
            birth_date: birthday,
            biography: random_user_info.biography,
            api_key: api_key,
            referral_code: '',
            signed_version,
            uuid: device_uuid,
            country_code: 'JP',
            email,
            app_version: '4.2',
            gender,
            signed_info,
            timestamp,
            email_grant_token,
        }, createAgent());

        if (response.result !== "success") {
            throw new Error(`Account creation failed for ${email}: ${JSON.stringify(response)}`);
        } else {
            log.success(`Account created successfully for ${email}.`);
        }

        return {
            ...response,
            random_user_info: random_user_info
        };
    });
}

function trim_url_prefix(url, prefix) {
    if (url.startsWith(prefix)) {
        return url.slice(prefix.length);
    }
    return url;
}

function random_gender() {
    const genders = [-1, 0, 1];
    return genders[Math.floor(Math.random() * genders.length)];
}

function random_birthday() {
    const startYear = 2000;
    const endYear = 2011;
    const year = Math.floor(Math.random() * (endYear - startYear + 1)) + startYear;
    const month = Math.floor(Math.random() * 12) + 1;
    const day = Math.floor(Math.random() * 28) + 1;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function generate_password() {
    const length = Math.floor(Math.random() * (12 - 8 + 1)) + 8;
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+~";
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generate_signed_info(length = 32) {
    const hexChars = "0123456789abcdef";
    return Array.from({ length }, () => hexChars[Math.floor(Math.random() * hexChars.length)]).join('');
}

function getStats() {
    return {
        requestCount,
        rateLimit: API_CONFIG.rateLimit,
        userTracking: getUsedUserStats()
    };
}

module.exports = {
    generate_password,
    get_email_verification_urls,
    post_email_verification_url,
    get_email_grant_tokens,
    get_random_user_info,
    register,
    getStats,
    getUsedUserStats,
    API_CONFIG
};

