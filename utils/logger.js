const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

class Logger {
    constructor(config) {
        this.config = config;
        this.logLevels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
        this.currentLevel = this.logLevels[config.logging.level] || 2;
        this.logQueue = [];
        this.isFlushing = false;
        
        // ログディレクトリの作成
        const logDir = path.dirname(config.logging.file);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        
        // バッチ処理の開始
        this.startBatchProcessing();
    }

    log(level, message, data = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            data,
            pid: process.pid
        };

        // コンソール出力
        this.consoleLog(level, message, data);
        
        // ファイル出力用にキューに追加
        this.logQueue.push(logEntry);
        
        // キューサイズが大きくなったら強制フラッシュ
        if (this.logQueue.length >= this.config.storage.batchSize) {
            this.flushLogs();
        }
    }

    consoleLog(level, message, data) {
        const colors = {
            error: chalk.red,
            warn: chalk.yellow,
            info: chalk.cyan,
            debug: chalk.gray
        };
        
        const icons = {
            error: '❌',
            warn: '⚠️',
            info: 'ℹ️',
            debug: '🐛'
        };
        
        const color = colors[level] || chalk.white;
        const icon = icons[level] || '📝';
        
        console.log(`${color}${icon} [${level.toUpperCase()}] ${message}`);
        
        if (Object.keys(data).length > 0) {
            console.log(chalk.gray(JSON.stringify(data, null, 2)));
        }
    }

    async flushLogs() {
        if (this.isFlushing || this.logQueue.length === 0) return;
        
        this.isFlushing = true;
        const logsToWrite = [...this.logQueue];
        this.logQueue = [];
        
        try {
            const logContent = logsToWrite
                .map(entry => JSON.stringify(entry))
                .join('\n') + '\n';
            
            fs.appendFileSync(this.config.logging.file, logContent);
        } catch (error) {
            console.error('Log flush error:', error);
            // エラーが発生した場合はキューに戻す
            this.logQueue.unshift(...logsToWrite);
        } finally {
            this.isFlushing = false;
        }
    }

    startBatchProcessing() {
        setInterval(() => {
            this.flushLogs();
        }, this.config.storage.flushInterval);
    }

    error(message, data = {}) {
        if (this.currentLevel >= this.logLevels.error) {
            this.log('error', message, data);
        }
    }

    warn(message, data = {}) {
        if (this.currentLevel >= this.logLevels.warn) {
            this.log('warn', message, data);
        }
    }

    info(message, data = {}) {
        if (this.currentLevel >= this.logLevels.info) {
            this.log('info', message, data);
        }
    }

    debug(message, data = {}) {
        if (this.currentLevel >= this.logLevels.debug) {
            this.log('debug', message, data);
        }
    }

    success(message, data = {}) {
        this.info(`✅ ${message}`, data);
    }

    // 統計情報の記録
    recordStats(stats) {
        this.info('Statistics', stats);
    }

    // アカウント作成の進捗記録
    recordProgress(current, total, success, failed) {
        const progress = {
            current,
            total,
            success,
            failed,
            percentage: Math.round((current / total) * 100),
            successRate: total > 0 ? Math.round((success / total) * 100) : 0
        };
        
        this.info('Progress Update', progress);
    }
}

module.exports = Logger;


