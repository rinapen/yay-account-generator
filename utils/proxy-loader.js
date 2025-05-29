const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');

const proxyList = fs.readFileSync('./data.txt', 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && line.startsWith('http'));

function getRandomProxyAgent() {
    
    const url = proxyList[Math.floor(Math.random() * proxyList.length)];
    return new HttpsProxyAgent(url);
}

module.exports = {
    getRandomProxyAgent,
    proxyList,
};