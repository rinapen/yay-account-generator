const fetch = require('node-fetch');

class APIClient {
    constructor(host, user_agent, device_uuid) {
        this.host = host;
        this.headers = {
            'User-Agent': user_agent,
            'Content-Type': 'application/json; charset=utf-8',
            'X-Device-UUID': device_uuid,
        };
    }

    async request(endpoint, method = 'GET', body = null, agent = null) {
        const url = `${this.host}${endpoint}`;
        const options = {
            method,
            headers: this.headers,
            agent
        };
        if (body) {
            options.body = JSON.stringify(body);
        }
    
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Error during request to ${url}:`, error);
            throw error;
        }
    }
    
}

module.exports = APIClient;