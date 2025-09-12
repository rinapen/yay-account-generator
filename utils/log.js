const chalk = require('chalk');

const log = {
  success: (msg) => console.log(chalk.green(`[SUCCESS]`) + chalk.white(` ${msg}`)),
  error: (msg) => console.error(chalk.red(`[ERROR]`) + chalk.white(` ${msg}`)),
  warn: (msg) => console.warn(chalk.yellow(`[WARN]`) + chalk.white(` ${msg}`)),
  info: (msg) => console.info(chalk.cyan(`[INFO]`) + chalk.white(` ${msg}`)),
  debug: (msg) => {
    if (process.env.DEBUG === 'true') {
      console.debug(chalk.magenta(`[DEBUG]`) + chalk.white(` ${msg}`));
    }
  }
};

module.exports = log;
