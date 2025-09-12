const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

class StorageManager {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.storageMode = config.storage.mode;
        this.batchSize = config.storage.batchSize;
        this.flushInterval = config.storage.flushInterval;
        
        this.accountQueue = [];
        this.isFlushing = false;
        this.stats = {
            saved: 0,
            failed: 0,
            lastFlush: null
        };

        // MongoDB接続
        if (this.storageMode === 'mongodb') {
            this.initializeMongoDB();
        }

        // バッチ処理の開始
        this.startBatchProcessing();
    }

    async initializeMongoDB() {
        try {
            await mongoose.connect(process.env.MONGODB_URI);
            this.logger.success('MongoDB Connected');
            
            const botSchema = new mongoose.Schema({
                email: String,
                password: String,
                user_id: String,
                uuid: String,
                access_token: String,
                refresh_token: String,
                created_at: { type: Date, default: Date.now }
            });
            
            this.Bot = mongoose.model('rinapen', botSchema);
        } catch (error) {
            this.logger.error('MongoDB connection failed', { error: error.message });
            throw error;
        }
    }

    async addAccount(accountData) {
        this.accountQueue.push({
            ...accountData,
            timestamp: Date.now()
        });

        this.logger.debug('Account added to queue', { 
            email: accountData.email,
            queueSize: this.accountQueue.length 
        });

        // キューサイズがバッチサイズに達したら即座にフラッシュ
        if (this.accountQueue.length >= this.batchSize) {
            await this.flushAccounts();
        }
    }

    async flushAccounts() {
        if (this.isFlushing || this.accountQueue.length === 0) return;

        this.isFlushing = true;
        const accountsToSave = [...this.accountQueue];
        this.accountQueue = [];

        try {
            this.logger.info(`Flushing ${accountsToSave.length} accounts to storage`, {
                storageMode: this.storageMode
            });

            if (this.storageMode === 'json') {
                await this.saveToJSON(accountsToSave);
            } else if (this.storageMode === 'mongodb') {
                await this.saveToMongoDB(accountsToSave);
            }

            this.stats.saved += accountsToSave.length;
            this.stats.lastFlush = new Date();

            this.logger.success(`Successfully saved ${accountsToSave.length} accounts`, {
                totalSaved: this.stats.saved,
                totalFailed: this.stats.failed
            });

        } catch (error) {
            this.stats.failed += accountsToSave.length;
            this.logger.error('Failed to save accounts', { 
                error: error.message,
                accountCount: accountsToSave.length 
            });

            // エラーが発生した場合はキューに戻す
            this.accountQueue.unshift(...accountsToSave);
        } finally {
            this.isFlushing = false;
        }
    }

    async saveToJSON(accounts) {
        const outputPath = path.join(__dirname, '..', 'new_accounts.json');
        
        try {
            let existingData = [];
            if (fs.existsSync(outputPath)) {
                const fileContent = fs.readFileSync(outputPath, 'utf-8');
                existingData = JSON.parse(fileContent);
            }

            const updatedData = [...existingData, ...accounts];
            fs.writeFileSync(outputPath, JSON.stringify(updatedData, null, 2), 'utf-8');

        } catch (error) {
            this.logger.error('JSON save error', { error: error.message });
            throw error;
        }
    }

    async saveToMongoDB(accounts) {
        try {
            const documents = accounts.map(account => new this.Bot(account));
            await this.Bot.insertMany(documents, { ordered: false });

        } catch (error) {
            this.logger.error('MongoDB save error', { error: error.message });
            throw error;
        }
    }

    startBatchProcessing() {
        setInterval(async () => {
            await this.flushAccounts();
        }, this.flushInterval);

        this.logger.info('Batch processing started', {
            interval: this.flushInterval,
            batchSize: this.batchSize
        });
    }

    async finalize() {
        this.logger.info('Finalizing storage operations');
        
        // 残りのアカウントをフラッシュ
        await this.flushAccounts();
        
        // MongoDB接続を閉じる
        if (this.storageMode === 'mongodb' && mongoose.connection.readyState === 1) {
            await mongoose.connection.close();
            this.logger.success('MongoDB connection closed');
        }

        // 最終統計を記録
        this.logger.recordStats({
            type: 'storage',
            saved: this.stats.saved,
            failed: this.stats.failed,
            successRate: this.stats.saved + this.stats.failed > 0 
                ? Math.round((this.stats.saved / (this.stats.saved + this.stats.failed)) * 100)
                : 0
        });
    }

    getStats() {
        return {
            ...this.stats,
            queueSize: this.accountQueue.length,
            isFlushing: this.isFlushing,
            storageMode: this.storageMode
        };
    }

    // アカウントの検索機能
    async findAccount(email) {
        if (this.storageMode === 'json') {
            const outputPath = path.join(__dirname, '..', 'new_accounts.json');
            if (fs.existsSync(outputPath)) {
                const accounts = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
                return accounts.find(account => account.email === email);
            }
        } else if (this.storageMode === 'mongodb') {
            return await this.Bot.findOne({ email });
        }
        return null;
    }

    // 統計情報の取得
    async getAccountStats() {
        if (this.storageMode === 'json') {
            const outputPath = path.join(__dirname, '..', 'new_accounts.json');
            if (fs.existsSync(outputPath)) {
                const accounts = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
                return {
                    total: accounts.length,
                    uniqueEmails: new Set(accounts.map(a => a.email)).size
                };
            }
        } else if (this.storageMode === 'mongodb') {
            const total = await this.Bot.countDocuments();
            const uniqueEmails = await this.Bot.distinct('email').count();
            return { total, uniqueEmails };
        }
        return { total: 0, uniqueEmails: 0 };
    }
}

module.exports = StorageManager;
