const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch');
const path = require('path'); // pathモジュールを追加

class ProxyManager {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.proxyList = [];
        this.currentProxyIndex = 0;
        this.proxyHealth = new Map();
        this.lastRotation = Date.now();
        
        this.loadProxyList();
        this.startHealthCheck();
    }

    loadProxyList() {
        try {
            // 環境変数からプロキシを読み込み
            if (process.env.PROXY_URL) {
                this.proxyList.push(process.env.PROXY_URL);
            }

            // ファイルからプロキシリストを読み込み
            const proxyFilePath = path.join(__dirname, '..', 'data.txt');
            if (fs.existsSync(proxyFilePath)) {
                const fileContent = fs.readFileSync(proxyFilePath, 'utf-8');
                const fileProxies = fileContent
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0 && line.startsWith('http'));
                
                this.proxyList.push(...fileProxies);
            }

            this.logger.info(`Loaded ${this.proxyList.length} proxies`);
            
            if (this.proxyList.length === 0) {
                this.logger.warn('No proxies available, running without proxy');
            }

        } catch (error) {
            this.logger.error('Failed to load proxy list', { error: error.message });
        }
    }

    getCurrentProxy() {
        if (this.proxyList.length === 0) {
            return null;
        }

        // プロキシローテーション
        const now = Date.now();
        if (now - this.lastRotation > this.config.proxy.rotationInterval) {
            this.rotateProxy();
            this.lastRotation = now;
        }

        return this.proxyList[this.currentProxyIndex];
    }

    getProxyAgent() {
        const proxyUrl = this.getCurrentProxy();
        if (!proxyUrl) {
            return undefined;
        }

        return new HttpsProxyAgent(proxyUrl);
    }

    rotateProxy() {
        if (this.proxyList.length <= 1) return;

        // ヘルスチェック結果に基づいてプロキシを選択
        const healthyProxies = this.proxyList.filter((_, index) => {
            const health = this.proxyHealth.get(index);
            return !health || health.isHealthy;
        });

        if (healthyProxies.length > 0) {
            const randomIndex = Math.floor(Math.random() * healthyProxies.length);
            this.currentProxyIndex = this.proxyList.indexOf(healthyProxies[randomIndex]);
        } else {
            // ヘルシーなプロキシがない場合はランダム選択
            this.currentProxyIndex = Math.floor(Math.random() * this.proxyList.length);
        }

        this.logger.debug('Proxy rotated', { 
            newProxy: this.proxyList[this.currentProxyIndex],
            index: this.currentProxyIndex 
        });
    }

    async checkProxyHealth(proxyUrl, index) {
        try {
            const agent = new HttpsProxyAgent(proxyUrl);
            const startTime = Date.now();
            
            const response = await fetch('https://httpbin.org/ip', {
                agent,
                timeout: 10000
            });

            const responseTime = Date.now() - startTime;
            const isHealthy = response.ok && responseTime < 5000;

            this.proxyHealth.set(index, {
                isHealthy,
                responseTime,
                lastCheck: Date.now(),
                errorCount: isHealthy ? 0 : (this.proxyHealth.get(index)?.errorCount || 0) + 1
            });

            if (!isHealthy) {
                this.logger.warn('Proxy health check failed', {
                    proxy: proxyUrl,
                    responseTime,
                    status: response.status
                });
            }

            return isHealthy;

        } catch (error) {
            const currentHealth = this.proxyHealth.get(index) || { errorCount: 0 };
            this.proxyHealth.set(index, {
                isHealthy: false,
                responseTime: null,
                lastCheck: Date.now(),
                errorCount: currentHealth.errorCount + 1,
                lastError: error.message
            });

            this.logger.debug('Proxy health check error', {
                proxy: proxyUrl,
                error: error.message
            });

            return false;
        }
    }

    startHealthCheck() {
        if (!this.config.proxy.healthCheck || this.proxyList.length === 0) return;

        setInterval(async () => {
            this.logger.debug('Starting proxy health check');
            
            for (let i = 0; i < this.proxyList.length; i++) {
                await this.checkProxyHealth(this.proxyList[i], i);
                // プロキシ間で少し待機
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            const healthyCount = Array.from(this.proxyHealth.values())
                .filter(health => health.isHealthy).length;

            this.logger.info('Proxy health check completed', {
                total: this.proxyList.length,
                healthy: healthyCount,
                unhealthy: this.proxyList.length - healthyCount
            });

        }, 300000); // 5分ごとにヘルスチェック
    }

    markProxyAsFailed(proxyUrl) {
        const index = this.proxyList.indexOf(proxyUrl);
        if (index !== -1) {
            const currentHealth = this.proxyHealth.get(index) || { errorCount: 0 };
            this.proxyHealth.set(index, {
                ...currentHealth,
                isHealthy: false,
                errorCount: currentHealth.errorCount + 1,
                lastError: 'Marked as failed by user'
            });

            this.logger.warn('Proxy marked as failed', { proxy: proxyUrl });
        }
    }

    getProxyStats() {
        const stats = {
            total: this.proxyList.length,
            healthy: 0,
            unhealthy: 0,
            currentProxy: this.proxyList[this.currentProxyIndex] || null,
            lastRotation: this.lastRotation
        };

        for (const health of this.proxyHealth.values()) {
            if (health.isHealthy) {
                stats.healthy++;
            } else {
                stats.unhealthy++;
            }
        }

        return stats;
    }

    // プロキシリストの更新
    updateProxyList(newProxies) {
        this.proxyList = [...new Set([...this.proxyList, ...newProxies])];
        this.proxyHealth.clear(); // ヘルス情報をリセット
        
        this.logger.info('Proxy list updated', { 
            newTotal: this.proxyList.length 
        });
    }

    // プロキシの削除
    removeProxy(proxyUrl) {
        const index = this.proxyList.indexOf(proxyUrl);
        if (index !== -1) {
            this.proxyList.splice(index, 1);
            this.proxyHealth.delete(index);
            
            // 現在のプロキシが削除された場合、インデックスを調整
            if (index <= this.currentProxyIndex && this.currentProxyIndex > 0) {
                this.currentProxyIndex--;
            }
            
            this.logger.info('Proxy removed', { proxy: proxyUrl });
        }
    }
}

module.exports = ProxyManager;
