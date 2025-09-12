class RateLimiter {
    constructor(config) {
        this.config = config;
        this.requestCounts = {
            minute: [],
            hour: []
        };
        this.burstCount = 0;
        this.lastBurstReset = Date.now();
        this.isInCooldown = false;
        this.cooldownEndTime = 0;
    }

    async waitForRateLimit() {
        const now = Date.now();
        
        // クールダウン期間のチェック
        if (this.isInCooldown && now < this.cooldownEndTime) {
            const remainingTime = this.cooldownEndTime - now;
            await this.delay(remainingTime);
            this.isInCooldown = false;
            this.cooldownEndTime = 0;
        }

        // バースト制限のチェック
        if (now - this.lastBurstReset > 1000) { // 1秒でリセット
            this.burstCount = 0;
            this.lastBurstReset = now;
        }

        if (this.burstCount >= this.config.rateLimit.burstLimit) {
            await this.delay(1000); // 1秒待機
            this.burstCount = 0;
        }

        // 分単位の制限チェック
        this.cleanupOldRequests(this.requestCounts.minute, 60000); // 1分前のリクエストを削除
        if (this.requestCounts.minute.length >= this.config.rateLimit.requestsPerMinute) {
            const oldestRequest = this.requestCounts.minute[0];
            const waitTime = 60000 - (now - oldestRequest);
            if (waitTime > 0) {
                await this.delay(waitTime);
            }
        }

        // 時間単位の制限チェック
        this.cleanupOldRequests(this.requestCounts.hour, 3600000); // 1時間前のリクエストを削除
        if (this.requestCounts.hour.length >= this.config.rateLimit.requestsPerHour) {
            const oldestRequest = this.requestCounts.hour[0];
            const waitTime = 3600000 - (now - oldestRequest);
            if (waitTime > 0) {
                await this.delay(waitTime);
            }
        }

        // リクエストを記録
        this.requestCounts.minute.push(now);
        this.requestCounts.hour.push(now);
        this.burstCount++;
    }

    cleanupOldRequests(requestArray, maxAge) {
        const now = Date.now();
        while (requestArray.length > 0 && (now - requestArray[0]) > maxAge) {
            requestArray.shift();
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // レート制限エラーが発生した場合のクールダウン
    triggerCooldown() {
        this.isInCooldown = true;
        this.cooldownEndTime = Date.now() + this.config.rateLimit.cooldownPeriod;
    }

    // 現在のレート制限状態を取得
    getStatus() {
        const now = Date.now();
        return {
            burstCount: this.burstCount,
            minuteRequests: this.requestCounts.minute.length,
            hourRequests: this.requestCounts.hour.length,
            isInCooldown: this.isInCooldown,
            cooldownRemaining: this.isInCooldown ? Math.max(0, this.cooldownEndTime - now) : 0
        };
    }

    // 動的レート制限調整
    adjustRateLimit(response) {
        if (response.status === 429) { // Too Many Requests
            this.triggerCooldown();
            return true;
        }
        return false;
    }
}

module.exports = RateLimiter;
