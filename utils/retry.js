class RetryManager {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.retryQueue = [];
        this.isProcessingQueue = false;
    }

    async executeWithRetry(operation, operationName, context = {}) {
        let lastError;
        
        for (let attempt = 1; attempt <= this.config.account.retryAttempts; attempt++) {
            try {
                this.logger.debug(`Attempting ${operationName}`, { 
                    attempt, 
                    maxAttempts: this.config.account.retryAttempts,
                    context 
                });

                const result = await operation();
                
                if (attempt > 1) {
                    this.logger.success(`${operationName} succeeded on attempt ${attempt}`, { context });
                }
                
                return result;
                
            } catch (error) {
                lastError = error;
                
                this.logger.warn(`${operationName} failed on attempt ${attempt}`, {
                    error: error.message,
                    context,
                    attempt,
                    maxAttempts: this.config.account.retryAttempts
                });

                // 最後の試行でない場合は待機
                if (attempt < this.config.account.retryAttempts) {
                    const delay = this.calculateDelay(attempt);
                    this.logger.info(`Retrying ${operationName} in ${delay}ms`, { context });
                    await this.delay(delay);
                }
            }
        }

        // すべての試行が失敗
        this.logger.error(`${operationName} failed after ${this.config.account.retryAttempts} attempts`, {
            error: lastError.message,
            context
        });

        // 失敗した操作をキューに追加（後で再試行）
        this.addToRetryQueue(operation, operationName, context);
        
        throw lastError;
    }

    calculateDelay(attempt) {
        if (this.config.account.exponentialBackoff) {
            // 指数バックオフ: 基本遅延 * 2^(試行回数-1)
            return this.config.account.retryDelay * Math.pow(2, attempt - 1);
        } else {
            // 固定遅延
            return this.config.account.retryDelay;
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    addToRetryQueue(operation, operationName, context) {
        this.retryQueue.push({
            operation,
            operationName,
            context,
            addedAt: Date.now(),
            attempts: 0
        });

        if (!this.isProcessingQueue) {
            this.processRetryQueue();
        }
    }

    async processRetryQueue() {
        if (this.isProcessingQueue || this.retryQueue.length === 0) return;
        
        this.isProcessingQueue = true;
        
        while (this.retryQueue.length > 0) {
            const item = this.retryQueue.shift();
            item.attempts++;
            
            try {
                this.logger.info(`Retrying queued operation: ${item.operationName}`, {
                    context: item.context,
                    attempts: item.attempts
                });
                
                await item.operation();
                this.logger.success(`Queued operation succeeded: ${item.operationName}`, {
                    context: item.context
                });
                
            } catch (error) {
                this.logger.error(`Queued operation failed: ${item.operationName}`, {
                    error: error.message,
                    context: item.context,
                    attempts: item.attempts
                });
                
                // 最大試行回数に達していない場合は再度キューに追加
                if (item.attempts < this.config.account.retryAttempts) {
                    this.retryQueue.push(item);
                    await this.delay(this.calculateDelay(item.attempts));
                }
            }
        }
        
        this.isProcessingQueue = false;
    }

    // 特定のエラーがリトライ可能かどうかを判定
    isRetryableError(error) {
        const retryableErrors = [
            'ECONNRESET',
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ENOTFOUND',
            'ENETUNREACH',
            'ECONNRESET',
            'EPIPE',
            'EAI_AGAIN'
        ];

        const retryableMessages = [
            'timeout',
            'network',
            'connection',
            'rate limit',
            'too many requests',
            'service unavailable',
            'internal server error'
        ];

        // エラーコードのチェック
        if (error.code && retryableErrors.includes(error.code)) {
            return true;
        }

        // エラーメッセージのチェック
        const errorMessage = error.message.toLowerCase();
        return retryableMessages.some(msg => errorMessage.includes(msg));
    }

    // 統計情報の取得
    getStats() {
        return {
            queueLength: this.retryQueue.length,
            isProcessing: this.isProcessingQueue
        };
    }
}

module.exports = RetryManager;
