const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { HttpsProxyAgent } = require("https-proxy-agent");

class EnhancedTempGmail {
    constructor(token, cookie, config, logger, retryManager, proxyManager) {
        this.token = token;
        this.cookie = cookie;
        this.config = config;
        this.logger = logger;
        this.retryManager = retryManager;
        this.proxyManager = proxyManager;
        this.domain = 'https://www.emailnator.com';
        this.email = null;
        this.messageID = null;
        this.lastProxyRotation = Date.now();
        this.proxyRotationInterval = 15000; // 15秒ごとにプロキシローテーション（短縮）
        this.maxStagnantTime = 20000; // 20秒で停滞とみなす
        this.lastSuccessfulRequest = Date.now();
    }

    async generateGmail() {
        return await this.retryManager.executeWithRetry(
            async () => {
                // プロキシローテーションのチェック
                await this.checkAndRotateProxy();
                
                const url = `${this.domain}/generate-email`;
                const headers = {
                    'x-xsrf-token': this.token,
                    'cookie': this.cookie,
                    'content-type': 'application/json, text/plain, */*'
                };
                const body = JSON.stringify({
                    email: ['dotGmail', 'googleMail']
                });

                const agent = this.proxyManager.getProxyAgent();
                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body,
                    agent,
                    timeout: this.config.timeout.apiRequest
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();
                if (!data.email || !Array.isArray(data.email) || data.email.length === 0) {
                    throw new Error('Invalid response format from email service');
                }

                const email = data.email[0];
                this.email = email;
                this.lastSuccessfulRequest = Date.now();
                
                this.logger.success(`Gmail generated successfully`, { email });
                return email;
            },
            'generateGmail'
        );
    }

    async setMessageID() {
        if (!this.email) {
            throw new Error('Gmail must be generated first');
        }

        return await this.retryManager.executeWithRetry(
            async () => {
                const url = `${this.domain}/message-list`;
                const headers = {
                    'x-xsrf-token': this.token,
                    'cookie': this.cookie,
                    'content-type': 'application/json, text/plain, */*'
                };
                const body = JSON.stringify({ email: this.email });

                const maxAttempts = Math.ceil(this.config.timeout.mailCheck / 2000);
                let attempt = 0;
                let lastProxyRotation = Date.now();
                let consecutiveFailures = 0;
                let lastSuccessfulCheck = Date.now();

                while (attempt < maxAttempts) {
                    const now = Date.now();
                    
                    // 停滞検出とプロキシローテーション
                    if (now - lastSuccessfulCheck > this.maxStagnantTime) {
                        this.logger.warn(`Stagnation detected, forcing proxy rotation`, {
                            email: this.email,
                            stagnantTime: now - lastSuccessfulCheck
                        });
                        await this.forceProxyRotation();
                        lastProxyRotation = now;
                        lastSuccessfulCheck = now;
                        consecutiveFailures = 0;
                    }
                    
                    // 定期的にプロキシをローテーション
                    if (now - lastProxyRotation > this.proxyRotationInterval) {
                        await this.checkAndRotateProxy();
                        lastProxyRotation = now;
                        consecutiveFailures = 0;
                    }

                    // 連続失敗時の強制ローテーション
                    if (consecutiveFailures >= 3) {
                        this.logger.warn(`Consecutive failures detected, forcing proxy rotation`, {
                            email: this.email,
                            consecutiveFailures
                        });
                        await this.forceProxyRotation();
                        lastProxyRotation = now;
                        consecutiveFailures = 0;
                    }

                    const agent = this.proxyManager.getProxyAgent();
                    const response = await fetch(url, {
                        method: 'POST',
                        headers,
                        body,
                        agent,
                        timeout: this.config.timeout.apiRequest
                    });

                    if (!response.ok) {
                        consecutiveFailures++;
                        // プロキシエラーの場合は即座にローテーション
                        if (response.status >= 500 || response.status === 429) {
                            this.logger.warn(`Proxy error detected, rotating proxy`, {
                                status: response.status,
                                email: this.email,
                                consecutiveFailures
                            });
                            await this.forceProxyRotation();
                            lastProxyRotation = now;
                            consecutiveFailures = 0;
                        } else {
                            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                        }
                    } else {
                        consecutiveFailures = 0;
                        lastSuccessfulCheck = now;
                        
                        const data = await response.json();
                        const messages = data.messageData;

                        for (const message of messages) {
                            if (message.from === 'no-reply@yay.space') {
                                this.messageID = message.messageID;
                                this.logger.success(`Email received from yay.space`, { 
                                    email: this.email,
                                    messageID: this.messageID,
                                    attempt: attempt + 1,
                                    totalTime: now - this.lastSuccessfulRequest
                                });
                                return this.messageID;
                            }
                        }
                    }

                    this.logger.debug(`Waiting for email from yay.space`, { 
                        email: this.email,
                        attempt: attempt + 1,
                        maxAttempts,
                        proxy: this.proxyManager.getCurrentProxy(),
                        consecutiveFailures,
                        stagnantTime: now - lastSuccessfulCheck
                    });

                    await this.delay(2000);
                    attempt++;
                }

                // タイムアウト時の処理
                this.logger.warn(`Email timeout reached, forcing proxy rotation`, {
                    email: this.email,
                    maxAttempts,
                    totalTime: Date.now() - this.lastSuccessfulRequest
                });
                await this.forceProxyRotation();
                throw new Error('Timeout waiting for email from yay.space');
            },
            'setMessageID',
            { email: this.email }
        );
    }

    async getTempAuthCode() {
        if (!this.messageID) {
            throw new Error('Message ID must be set first');
        }

        return await this.retryManager.executeWithRetry(
            async () => {
                // プロキシローテーションのチェック
                await this.checkAndRotateProxy();
                
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

                const agent = this.proxyManager.getProxyAgent();
                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body,
                    agent,
                    timeout: this.config.timeout.apiRequest
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const htmlText = await response.text();
                const $ = cheerio.load(htmlText);
                const authCode = $('span[style*="font-weight: 700"][style*="font-size: 24px"][style*="color: #212121"]').text().trim();

                if (!authCode) {
                    throw new Error('Authentication code not found in email');
                }

                this.logger.success(`Authentication code retrieved`, { 
                    email: this.email,
                    code: authCode 
                });
                return authCode;
            },
            'getTempAuthCode',
            { email: this.email, messageID: this.messageID }
        );
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // プロキシローテーションのチェックと実行
    async checkAndRotateProxy() {
        const now = Date.now();
        if (now - this.lastProxyRotation > this.proxyRotationInterval) {
            await this.forceProxyRotation();
            this.lastProxyRotation = now;
        }
    }

    // 強制プロキシローテーション
    async forceProxyRotation() {
        try {
            this.proxyManager.forceRotateProxy();
            const currentProxy = this.proxyManager.getCurrentProxy();
            this.logger.info(`Proxy force rotated`, { 
                newProxy: currentProxy,
                email: this.email 
            });
            
            // プロキシ切り替え後に少し待機
            await this.delay(2000);
        } catch (error) {
            this.logger.warn(`Proxy rotation failed`, { 
                error: error.message,
                email: this.email 
            });
        }
    }

    // メールサービスの状態確認
    async checkServiceHealth() {
        try {
            const agent = this.proxyManager.getProxyAgent();
            const response = await fetch(this.domain, {
                method: 'GET',
                agent,
                timeout: 10000
            });

            return response.ok;
        } catch (error) {
            this.logger.warn('Email service health check failed', { 
                error: error.message 
            });
            return false;
        }
    }

    // 現在の状態を取得
    getStatus() {
        const now = Date.now();
        return {
            email: this.email,
            messageID: this.messageID,
            hasEmail: !!this.email,
            hasMessageID: !!this.messageID,
            currentProxy: this.proxyManager.getCurrentProxy(),
            lastProxyRotation: this.lastProxyRotation,
            timeSinceLastSuccess: now - this.lastSuccessfulRequest,
            isStagnant: now - this.lastSuccessfulRequest > this.maxStagnantTime
        };
    }

    // リセット機能
    reset() {
        this.email = null;
        this.messageID = null;
        this.lastProxyRotation = Date.now();
        this.lastSuccessfulRequest = Date.now();
        this.logger.debug('TempGmail state reset');
    }
}

module.exports = EnhancedTempGmail;

