const fetch = require('node-fetch');
const { v4: generateUUID } = require('uuid');
const { HttpsProxyAgent } = require('https-proxy-agent');
const APIClient = require('../APIClient');
const { faker, fakerJA } = require('@faker-js/faker');
const { getColor } = require('./color');

const proxyUrl = process.env.PROXY_URL;
const createAgent = () => proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
const device_uuid = generateUUID();

let aiToolsCount = 0;
const MAX_AI_TOOLS_DEBUG = 5;

const yayClient = new APIClient(
    process.env.YAY_API_HOST,
    process.env.USER_AGENT,
    device_uuid
);

async function get_email_verification_urls(email) {
    try {
        const data = await yayClient.request('/v1/email_verification_urls', 'POST', {
            email,
            intent: 'sign_up',
            locale: 'ja',
            device_uuid: yayClient.headers['X-Device-UUID'],
        }, createAgent());
        return data.url;
    } catch (err) {
        console.error(`[get_email_verification_urls]: Failed to get verification URL for ${email}:`, err);
    }
};

async function get_email_grant_tokens(email, code) {
    const client = new APIClient(
        'https://idcardcheck.com',
        yayClient.headers['User-Agent'],
        yayClient.headers['X-Device-UUID']
    );
    const data = await client.request('/apis/v1/apps/yay/email_grant_tokens', 'POST', { email, code });
    return data.email_grant_token;
};

async function post_email_verification_url(email_verification_url, email) {
    try {
        const response = await fetch(email_verification_url, {
            method: 'POST',
            headers: yayClient.headers,
            body: JSON.stringify({ email, locale: 'ja' }),
            agent: createAgent()
        });

        let data;
        try {
            data = await response.json();
        } catch (jsonErr) {
            console.error(`[post_email_verification_url]: Invalid JSON response for ${email}:`, jsonErr);
            return;
        }

        if (data.status !== "success") {
            console.log(`[post_email_verification_url]: Gmail verification failed for ${email}.`);
        } else {
            console.log(`${getColor("green")}[success]: ${getColor("white")}Gmail verification successful for ${email}.`);
        }
    } catch (err) {
        console.error(`[post_email_verification_url]: Error while verifying email for ${email}:`, err);
    }
};

async function get_random_user_info() {
    try {
        const data = await yayClient.request('/v2/posts/timeline', "GET", null, createAgent());
        const randomIndex = Math.floor(Math.random() * Math.min(data.posts.length, 5));
        const user = data.posts[randomIndex].user;

        if (user.profile_icon_thumbnail) {
            console.log(user.profile_icon_thumbnail);
        }

        return {
            nickname: user.nickname || getRandomJapaneseName(),
            biography: user.biography || '',
            profile_icon: user.profile_icon || '',
            profile_icon_thumbnail: user.profile_icon_thumbnail || '',
        };
    } catch (err) {
        console.error(`[get_random_user_info]: Failed to get random user info:`, err);
    }
}

function getRandomJapaneseName() {
    const gender = Math.random() < 0.5 ? 'male' : 'female'; 
    return faker.person.firstName(gender);
}

async function register(email, password, email_grant_token) {
    if (!email_grant_token) {
        console.error(`[register]: Skipped account creation for ${email} due to missing email_grant_token.`);
        return;
    }

    try {
        const random_user_info = await get_random_user_info();
        if (!random_user_info) {
            console.error(`[register]: Failed to get user info for ${email}.`);
            return;
        }

        const setting = `\n設定を開始します...\nユーザー名: [${random_user_info.nickname}]\n自己紹介: [${random_user_info.biography}]`;
        console.log(setting);

        const profile_icon_filename = trim_url_prefix(random_user_info.profile_icon, "https://cdn.yay.space/uploads/");
        const uuid = yayClient.headers['X-Device-UUID'];
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
            uuid,
            country_code: 'JP',
            email,
            app_version: '4.2',
            gender,
            signed_info,
            timestamp,
            email_grant_token,
        }, createAgent());

        if (response.result !== "success") {
            console.log(`${getColor("red")}[error]: ${getColor("white")}Account creation failed for ${email}: ${response}`);
        } else {
            console.log(`${getColor("green")}[success]: ${getColor("white")}Account created successfully for ${email}.`);
        }

        console.log('='.repeat(40));
        return response;
    } catch (err) {
        console.error(`[register]: Error creating account for ${email}:`, err);
    }
};

function trim_url_prefix(url, prefix) {
    if (url.startsWith(prefix)) {
        return url.slice(prefix.length);
    }
    return url;
};

function random_gender() {
    const genders = [-1, 0, 1];
    return genders[Math.floor(Math.random() * genders.length)];
};

function random_birthday() {
    const startYear = 2000;
    const endYear = 2011;
    const year = Math.floor(Math.random() * (endYear - startYear + 1)) + startYear;
    const month = Math.floor(Math.random() * 12) + 1;
    const day = Math.floor(Math.random() * 28) + 1;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

function generate_password() {
    const length = Math.floor(Math.random() * (12 - 8 + 1)) + 8;
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+~";
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

function generate_signed_info(length = 32) {
    const hexChars = "0123456789abcdef";
    return Array.from({ length }, () => hexChars[Math.floor(Math.random() * hexChars.length)]).join('');
};

function logDebug(msg) {
    if (msg === 'AI TOOLS') {
        if (aiToolsCount < MAX_AI_TOOLS_DEBUG) {
            console.debug(`[debug]: ${msg}`);
            aiToolsCount++;
        } else if (aiToolsCount === MAX_AI_TOOLS_DEBUG) {
            console.debug(`[debug]: ${msg} (suppressed after 5 occurrences)`);
            aiToolsCount++;
        }
    } else {
        console.debug(`[debug]: ${msg}`);
    }
}

module.exports = {
    generate_password,
    get_email_verification_urls,
    post_email_verification_url,
    get_email_grant_tokens,
    get_random_user_info,
    register,
    logDebug
};