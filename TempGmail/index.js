const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { getColor } = require("../utils/color");
const { HttpsProxyAgent } = require("https-proxy-agent");

const proxyUrl = process.env.PROXY_URL;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const createFetchOptions = (method, headers, body) => {
    const options = {
        method,
        headers,
        body
    };
    if (proxyUrl) {
        options.agent = new HttpsProxyAgent(proxyUrl);
    }
    return options;
};

class TempGmail {
    constructor(token, cookie) {
        this.token = token;
        this.cookie = cookie;
        this.domain = 'https://www.emailnator.com';
    }

    async generateGmail() {
        try {
            const url = `${this.domain}/generate-email`;

            const headers = {
                'x-xsrf-token': this.token,
                'cookie': this.cookie,
                'content-type': 'application/json, text/plain, */*'
            };

            const body = JSON.stringify({
                email: ['dotGmail', 'googleMail']
            });

            const response = await fetch(url, createFetchOptions('POST', headers, body));

            if (!response.ok) {
                console.log(`${getColor("red")}[ERROR]${getColor("white")} response status is ${response.status}, ${response.statusText}`);
                return;
            }

            const data = await response.json();

            if (!data.email || !Array.isArray(data.email) || data.email.length === 0) {
                console.log(`${getColor("red")}[ERROR]${getColor("white")} Invalid response format`);
                return;
            }

            const email = data.email[0];
            console.log(`${getColor("green")}[SUCCESS]${getColor("white")} Gmail [${email}] を取得しました。`);
            this.email = email;
            return email;
        } catch (err) {
            console.log(`${getColor("red")}[ERROR]${getColor("white")} ${err.message}`);
        }
    }

    async setMessageID() {
        if (!this.email) return console.log(`${getColor("yellow")}[WARN]${getColor("white")} 先にGmailを作成してください`);

        try {
            const url = `${this.domain}/message-list`;

            const headers = {
                'x-xsrf-token': this.token,
                'cookie': this.cookie,
                'content-type': 'application/json, text/plain, */*'
            };

            const body = JSON.stringify({
                email: this.email
            });

            let isSuccess = false;
            let attemptCount = 0;
            const maxAttempts = 3;

            while (!isSuccess && attemptCount < maxAttempts) {
                attemptCount++;
                const response = await fetch(url, createFetchOptions('POST', headers, body));

                if (!response.ok) {
                    return console.log(`${getColor("red")}[ERROR]${getColor("white")} response status is ${response.status}, ${response.statusText}`);
                }

                const data = await response.json();
                const messages = data.messageData;

                for (const message of messages) {
                    const from = message.from;
                    if (from === 'no-reply@yay.space') {
                        this.messageID = message.messageID;
                        console.log(`${getColor("green")}[SUCCESS]${getColor("white")} メールを受信しました。`);
                        isSuccess = true;
                        break;
                    } else {
                        console.log(`${getColor("magenta")}[DEBUG]${getColor("white")} ${from}`);
                    }
                }
                
                if (!isSuccess) {
                    if (attemptCount < maxAttempts) {
                        console.log(`${getColor("yellow")}[WARN]${getColor("white")} メール未受信 (${attemptCount}/${maxAttempts}) - 2秒後に再試行`);
                        await delay(2000);
                    } else {
                        console.log(`${getColor("red")}[ERROR]${getColor("white")} メール受信タイムアウト (${maxAttempts}回試行) - スキップします`);
                        return false;
                    }
                }
            }
        } catch (err) {
            if (err.name === 'SyntaxError') {
                console.log(`${getColor("red")}[ERROR]${getColor("white")} JSONパースエラー: ${err.message}`);
            } else {
                console.log(`${getColor("red")}[ERROR]${getColor("white")} ${err.message}`);
            }
        }
    }

    async getTempAuthCode() {
        if (!this.messageID) return console.log(`${getColor("yellow")}[WARN]${getColor("white")} メッセージIDをセットしてください。`);

        try {
            const url = `${this.domain}/message-list`;

            const headers = {
                'x-xsrf-token': this.token,
                'cookie': this.cookie,
                'content-type': 'application/json, text/plain, */*'
            };

            const body = JSON.stringify({
                email: this.email,
                messageID: this.messageID
            });

            const response = await fetch(url, createFetchOptions('POST', headers, body));

            if (!response.ok) {
                return console.log(`[fetch error]: response status is ${response.status}, ${response.statusText}`);
            }

            const htmlText = await response.text();
            const $ = cheerio.load(htmlText);
            const authCode = $('span[style*="font-weight: 700"][style*="font-size: 24px"][style*="color: #212121"]').text().trim();

            if (authCode) {
                console.log(`${getColor("green")}[SUCCESS]${getColor("white")} コード[${authCode}]を取得しました。`);
                return authCode;
            } else {
                console.log(`${getColor("yellow")}[WARN]${getColor("white")} 認証コードが見つかりませんでした。`);
                return null;
            }
        } catch (err) {
            if (err.name === 'SyntaxError') {
                console.log(`${getColor("red")}[ERROR]${getColor("white")} JSONパースエラー: ${err.message}`);
            } else {
                console.log(`${getColor("red")}[ERROR]${getColor("white")} ${err.message}`);
            }
        }
    }
}

module.exports = TempGmail;