const fetch = require('node-fetch');
const { v4: generateUUID } = require('uuid');
const { HttpsProxyAgent } = require('https-proxy-agent');
const APIClient = require('../APIClient');
const { faker, fakerJA } = require('@faker-js/faker');
const log = require('./log');

const proxyUrl = process.env.PROXY_URL;
const createAgent = () => proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
const device_uuid = generateUUID();

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
        log.success(`認証URL取得に成功。[${email}]`);
        return data.url;
    } catch (err) {
        log.error(`[get_email_verification_urls]: Failed for ${email}: ${err}`);
    }
};

async function get_email_grant_tokens(email, code) {
    const client = new APIClient(
        'https://idcardcheck.com',
        yayClient.headers['User-Agent'],
        yayClient.headers['X-Device-UUID']
    );
    const data = await client.request('/apis/v1/apps/yay/email_grant_tokens', 'POST', { email, code }, createAgent());
    log.success(`email_grant_token取得に成功。[${email}]`);
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

        const data = await response.json();
        if (data.status !== "success") {
            log.error(`[post_email_verification_url]: Gmail verification failed for ${email}.`);
        } else {
            log.success(`Gmail verification successful for ${email}.`);
        }
    } catch (err) {
        log.error(`[post_email_verification_url]: Error for ${email}: ${err}`);
    }
};

async function get_random_user_info() {
    try {
        const data = await yayClient.request('/v2/posts/timeline', "GET", null, createAgent());
        const randomIndex = Math.floor(Math.random() * Math.min(data.posts.length, 5));
        const user = data.posts[randomIndex].user;
        log.debug(user.profile_icon_thumbnail);
        return {
            nickname: user.nickname || getRandomJapaneseName(),
            biography: user.biography || '',
            profile_icon: user.profile_icon || '',
            profile_icon_thumbnail: user.profile_icon_thumbnail || '',
        };
    } catch (err) {
        log.error(`[get_random_user_info]: Failed: ${err}`);
    }
}

function getRandomJapaneseName() {
    const gender = Math.random() < 0.5 ? 'male' : 'female'; 
    return faker.person.firstName(gender);
}

async function register(email, password, email_grant_token) {
    try {
        if (!email_grant_token) {
            log.warn(`[register]: email_grant_tokenが無効のためスキップ: ${email}`);
            return;
        }

        const random_user_info = await get_random_user_info();
        if (!random_user_info) {
            log.error(`[register]: Failed to get user info for ${email}.`);
            return;
        }

        log.info(`設定を開始します...\nユーザー名: [${random_user_info.nickname}]\n自己紹介: [${random_user_info.biography}]`);

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
            log.error(`Account creation failed for ${email}: ${JSON.stringify(response)}`);
        } else {
            log.success(`Account created successfully for ${email}.`);
        }

        return response;
    } catch (err) {
        log.error(`[register]: Error creating account for ${email}: ${err}`);
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
}

// JWTトークンを取得する関数
async function getJwtToken(accessToken) {
    try {
        const url = 'https://yay.space/api/jwt';
        const headers = {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'ja',
            'agent': 'YayWeb 4.18.2',
            'authorization': `Bearer ${accessToken}`,
            'baggage': 'sentry-environment=production,sentry-public_key=4a55ec61d9f9565a070e92da003d0e97,sentry-trace_id=b49b4e942df24be1a6d97af2fda9034f,sentry-sample_rate=0.5,sentry-sampled=false',
            'cache-control': 'no-cache',
            'pragma': 'no-cache',
            'priority': 'u=1, i',
            'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'sentry-trace': 'a3b72719b8234e38b2c96c8cb24c5771-a0f82edcb7a3c0ac-0',
            'x-device-info': 'Yay 4.18.2 Web (Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36)',
            'Referer': 'https://yay.space/'
        };

        const response = await fetch(url, {
            method: 'GET',
            headers: headers,
            agent: createAgent()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        log.success('JWT取得成功');
        return data.jwt;
    } catch (err) {
        log.error(`[getJwtToken]: JWT取得に失敗: ${err.message}`);
        throw err;
    }
}

// ユーザー情報を取得する関数
async function getUserInfo(userId, accessToken) {
    try {
        const url = `https://api.yay.space/v2/users/${userId}`;
        const headers = {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'ja',
            'agent': 'YayWeb 4.18.2',
            'authorization': `Bearer ${accessToken}`,
            'cache-control': 'no-cache',
            'pragma': 'no-cache',
            'priority': 'u=1, i',
            'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'x-device-info': 'Yay 4.18.2 Web (Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36)',
            'Referer': 'https://yay.space/'
        };

        const response = await fetch(url, {
            method: 'GET',
            headers: headers,
            agent: createAgent()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        log.success(`ユーザー情報取得成功: ユーザーID ${userId}`);
        return data;
    } catch (err) {
        log.error(`[getUserInfo]: ユーザーID ${userId} の情報取得に失敗: ${err.message}`);
        return null;
    }
}

// ユーザーのタイムラインを取得する関数
async function getUserTimeline(userId, accessToken, number = 50) {
    try {
        const url = `https://api.yay.space/v2/posts/user_timeline?number=${number}&user_id=${userId}`;
        const headers = {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'ja',
            'agent': 'YayWeb 4.18.2',
            'authorization': `Bearer ${accessToken}`,
            'cache-control': 'no-cache',
            'pragma': 'no-cache',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'x-device-info': 'Yay 4.18.2 Web (Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36)',
            'Referer': 'https://yay.space/'
        };

        const response = await fetch(url, {
            method: 'GET',
            headers: headers,
            agent: createAgent()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        log.success(`タイムライン取得成功: ユーザーID ${userId}, ${data.posts?.length || 0}件の投稿`);
        return data.posts || [];
    } catch (err) {
        log.error(`[getUserTimeline]: ユーザーID ${userId} のタイムライン取得に失敗: ${err.message}`);
        return [];
    }
}

// 投稿を作成する関数
async function createPost(text, accessToken, deviceUuid) {
    try {
        // まずJWTトークンを取得
        const jwtToken = await getJwtToken(accessToken);
        
        const url = 'https://yay.space/api/posts';
        const headers = {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'ja',
            'agent': 'YayWeb 4.18.2',
            'authorization': `Bearer ${accessToken}`,
            'baggage': 'sentry-environment=production,sentry-public_key=4a55ec61d9f9565a070e92da003d0e97,sentry-trace_id=ade5671985054a96b600dfce671dfff7,sentry-sample_rate=0.5,sentry-sampled=false',
            'cache-control': 'no-cache',
            'content-type': 'application/json;charset=UTF-8',
            'pragma': 'no-cache',
            'priority': 'u=1, i',
            'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'sentry-trace': 'ade5671985054a96b600dfce671dfff7-b8931922b6297e6b-0',
            'x-jwt': jwtToken,
            'x-device-info': 'Yay 4.18.2 Web (Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36)',
            'Referer': 'https://yay.space/'
        };

        const body = {
            post_type: 'text',
            text: text,
            language: null,
            color: '0',
            font_size: '0',
            message_tags: '[]',
            uuid: deviceUuid
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body),
            agent: createAgent()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        log.success(`投稿成功: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`);
        return data;
    } catch (err) {
        log.error(`[createPost]: 投稿に失敗: ${err.message}`);
        throw err;
    }
}

// プロフィール編集API
async function editProfile(accessToken, nickname = null, biography = null, coverImageFilename = null) {
    try {
        // JWTトークンを取得
        const jwtToken = await getJwtToken(accessToken);
        
        const url = 'https://api.yay.space/v3/users/edit';
        const headers = {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'ja',
            'agent': 'YayWeb 4.18.2',
            'authorization': `Bearer ${accessToken}`,
            'cache-control': 'no-cache',
            'content-type': 'application/json;charset=UTF-8',
            'pragma': 'no-cache',
            'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'x-app-version': '4.18.2',
            'x-jwt': jwtToken,
            'x-device-info': 'Yay 4.18.2 Web (Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36)',
            'Referer': 'https://yay.space/'
        };

        const body = {};
        if (nickname !== null) body.nickname = nickname;
        if (biography !== null) body.biography = biography;
        if (coverImageFilename !== null) body.cover_image_filename = coverImageFilename;

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body),
            agent: createAgent()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        log.success('プロフィール編集成功');
        return data;
    } catch (err) {
        log.error(`[editProfile]: プロフィール編集に失敗: ${err.message}`);
        throw err;
    }
}

async function selectValidUser(timelinePosts, accessToken, accountEmail = 'unknown') {
    try {
        log.info(`[${accountEmail}] タイムラインから1人のユーザーを確認します...`);
        
        // 各アカウントで異なるユーザーを選択するためにランダムインデックスを使用
        const randomIndex = Math.floor(Math.random() * timelinePosts.length);
        const post = timelinePosts[randomIndex];
        
        if (post && post.user && post.user.id) {
            const userId = post.user.id;
            
            // このユーザーの詳細情報を取得してcover_imageを確認
            try {
                log.info(`[${accountEmail}] ユーザーID ${userId} の情報を確認中...`);
                const userInfo = await getUserInfo(userId, accessToken);
                if (userInfo && userInfo.user.cover_image) {
                    log.info(`[${accountEmail}] 有効なコピー元ユーザーを発見: ID ${userId} (cover_image有り)`);
                    return {
                        userId: userId,
                        user: post.user,
                        userInfo: userInfo
                    };
                } else {
                    log.info(`[${accountEmail}] ユーザーID ${userId} にcover_imageがありません`);
                }
            } catch (testErr) {
                // 403エラーの場合はBAN対策を停止
                if (testErr.message && testErr.message.includes('403')) {
                    log.warn(`[${accountEmail}] 403エラー検知: BAN対策を停止して次のアカウントに進みます`);
                    return null;
                }
                log.warn(`[${accountEmail}] ユーザーID ${userId} の情報取得に失敗: ${testErr.message}`);
            }
        }
        
        // cover_imageがあるユーザーが見つからない場合は最初のユーザーを返す
        if (timelinePosts.length > 0 && timelinePosts[0].user) {
            log.warn('cover_image付きユーザーが見つからないため、最初のユーザーを使用（cover_imageなし）');
            return {
                userId: timelinePosts[0].user.id,
                user: timelinePosts[0].user,
                userInfo: null // cover_imageなし
            };
        }
        
        return null;
    } catch (err) {
        log.error(`[selectValidUser]: ユーザー選択に失敗: ${err.message}`);
        return null;
    }
}

async function copyUserPosts(originalTimelinePosts, accessToken, deviceUuid, maxPosts = 15, accountUserInfo = null) {
    try {
        const accountEmail = accountUserInfo?.email || 'unknown';
        log.info(`[${accountEmail}] BAN対策: 動的にコピー元ユーザーを選択します...`);
        
         // 有効なユーザーを選択（このアカウント専用）
         const selectedUser = await selectValidUser(originalTimelinePosts, accessToken, accountEmail);
         if (!selectedUser) {
             log.error(`[${accountEmail}] コピー可能なユーザーが見つかりません`);
             return;
         }

         const sourceUserId = selectedUser.userId;
         const sourceUser = selectedUser.user;
         const sourceUserInfo = selectedUser.userInfo;
         
         log.info(`[${accountEmail}] BAN対策: ユーザーID ${sourceUserId} (${sourceUser.nickname}) の投稿をコピーします...`);
         
         // cover_imageを設定
         if (sourceUserInfo && sourceUserInfo.user.cover_image) {
             try {
                 // cover_imageのファイル名を抽出（URLプレフィックスを削除）
                 const coverImageUrl = sourceUserInfo.user.cover_image;
                 
                 // https://cdn.yay.space/uploads/ を削除してs3から始まるファイル名にする
                 const urlPrefix = 'https://cdn.yay.space/uploads/';
                 let coverImageFilename;
                 if (coverImageUrl.startsWith(urlPrefix)) {
                     coverImageFilename = coverImageUrl.substring(urlPrefix.length);
                 } else {
                     // プレフィックスがない場合はそのまま使用
                     coverImageFilename = coverImageUrl.split('/').pop();
                 }
                 
                 // アカウント作成時に使用した名前と自己紹介を再利用
                 const nickname = accountUserInfo?.nickname || "ユーザー";
                 const biography = accountUserInfo?.biography || "";
                 
                 await editProfile(accessToken, nickname, biography, coverImageFilename);
                 log.success(`[${accountEmail}] プロフィール編集完了: ${nickname}, cover_image: ${coverImageFilename}`);
             } catch (thumbnailErr) {
                 // 403エラーの場合はBAN対策を停止
                 if (thumbnailErr.message && thumbnailErr.message.includes('403')) {
                     log.warn(`[${accountEmail}] 403エラー検知: BAN対策を停止して次のアカウントに進みます`);
                     return;
                 }
                 log.warn(`[${accountEmail}] プロフィール編集に失敗: ${thumbnailErr.message}`);
             }
         } else {
             log.info(`[${accountEmail}] cover_imageが見つからないため、サムネイル設定をスキップします`);
         }
         
         // タイムラインを取得
         const posts = await getUserTimeline(sourceUserId, accessToken, 50);
         
         if (posts.length === 0) {
             log.warn(`[${accountEmail}] コピー元のタイムラインが空です`);
             return;
         }

         // 文字が含まれる投稿のみをフィルタリング
         const textPosts = posts.filter(post => 
             post.text && 
             post.text.trim().length > 0 && 
             post.text.trim().length <= 140 // 長すぎる投稿は除外
         );

         if (textPosts.length === 0) {
             log.warn(`[${accountEmail}] コピー可能なテキスト投稿が見つかりません`);
             return;
         }

         // 利用可能な投稿数と最大投稿数の小さい方を使用
         const actualPostCount = Math.min(textPosts.length, maxPosts);
         const postsToUse = textPosts.slice(0, actualPostCount);

         log.info(`[${accountEmail}] ${actualPostCount}件のテキスト投稿をコピーします（利用可能: ${textPosts.length}件, 最大: ${maxPosts}件）`);

         // 投稿を順番に作成（間隔を空けて）
         for (let i = 0; i < postsToUse.length; i++) {
             const post = postsToUse[i];
             const text = post.text.trim();
             
             try {
                 await createPost(text, accessToken, deviceUuid);
                 log.info(`[${accountEmail}] 投稿 ${i + 1}/${actualPostCount} 完了`);
                 
                 // 次の投稿まで待機（BAN対策）
                 if (i < postsToUse.length - 1) {
                     const waitTime = Math.random() * 100 + 150; // 0.15-0.25秒のランダム待機
                     log.info(`[${accountEmail}] 次の投稿まで ${Math.round(waitTime/1000)} 秒待機...`);
                     await new Promise(resolve => setTimeout(resolve, waitTime));
                 }
             } catch (err) {
                 // 403エラーの場合はBAN対策を停止
                 if (err.message && err.message.includes('403')) {
                     log.warn(`[${accountEmail}] 403エラー検知: BAN対策を停止して次のアカウントに進みます`);
                     return;
                 }
                 log.error(`[${accountEmail}] 投稿 ${i + 1} に失敗: ${err.message}`);
                 // その他のエラーは続行
             }
         }
         
         log.success(`[${accountEmail}] BAN対策投稿完了: ${actualPostCount}件の投稿をコピーしました`);
    } catch (err) {
        log.error(`[${accountEmail}] [copyUserPosts]: BAN対策投稿に失敗: ${err.message}`);
    }
}

module.exports = {
    generate_password,
    get_email_verification_urls,
    post_email_verification_url,
    get_email_grant_tokens,
    get_random_user_info,
    register,
    getUserTimeline,
    createPost,
    copyUserPosts,
    editProfile,
    selectValidUser,
    getJwtToken,
    getUserInfo,
};