# Yay Account Generator

An automated account generation tool for the Yay platform. This enhanced version includes retry mechanisms, rate limiting, structured logging, configuration management, and batch processing capabilities.

## Features

The generator includes several key improvements over basic account creation tools:

- **Retry System** - Automatic retry with exponential backoff for failed operations
- **Rate Limiting** - Dynamic rate limit detection and adjustment to avoid API blocks
- **Structured Logging** - JSON-formatted logs with file output for better monitoring
- **Configuration Management** - External configuration files for flexible deployment
- **Batch Processing** - Asynchronous batch processing for improved performance
- **Proxy Management** - Health checking and automatic rotation of proxy servers
- **Error Handling** - Comprehensive error processing and classification

## Project Structure

```
yay_account-generator/
├── config.json                 # Main configuration file
├── index.js                    # Primary application entry point
├── utils/
│   ├── api-enhanced.js         # Enhanced API client
│   ├── api.js                  # Original API utilities
│   ├── logger.js               # Structured logging system
│   ├── rate-limiter.js         # Rate limiting management
│   ├── retry.js                # Retry functionality
│   ├── storage-manager.js      # Batch processing storage
│   ├── proxy-manager.js        # Proxy management system
│   └── token-cookie-generator.js # Token and cookie utilities
├── TempGmail/
│   ├── enhanced.js             # Enhanced temporary email handler
│   └── index.js                # Original temporary email client
├── accounts/                   # Generated account storage (organized by date)
├── tools/                      # Additional utilities
└── logs/                       # Application log files
```

## Configuration

### config.json

```json
{
  "account": {
    "numAccountsToCreate": 70000,
    "maxConcurrentAccounts": 4,
    "retryAttempts": 3,
    "retryDelay": 5000,
    "exponentialBackoff": true
  },
  "rateLimit": {
    "requestsPerMinute": 60,
    "requestsPerHour": 1000,
    "burstLimit": 10,
    "cooldownPeriod": 60000
  },
  "timeout": {
    "emailVerification": 10000,
    "apiRequest": 15000,
    "mailCheck": 30000
  },
  "storage": {
    "mode": "json",
    "batchSize": 100,
    "flushInterval": 5000
  },
  "logging": {
    "level": "info",
    "file": "logs/app.log",
    "maxSize": "10m",
    "maxFiles": 5
  },
  "proxy": {
    "enabled": true,
    "rotationInterval": 300000,
    "healthCheck": true
  }
}
```

### Environment Variables

Create a `.env` file in the project root with the following variables:

```bash
# Required
YAY_API_HOST=https://api.yay.space
USER_AGENT=your_user_agent
API_KEY=your_api_key
SIGNED_INFO=your_signed_info

# MongoDB (when using database storage)
MONGODB_URI=mongodb://localhost:27017/yay_accounts

# Proxy settings (optional)
PROXY_URL=http://proxy.example.com:8080
```

## Getting Started

### Installation

Install the required dependencies:

```bash
npm install
```

### Configuration

Edit the `config.json` file to adjust settings according to your needs. The configuration includes parameters for account creation limits, retry settings, rate limiting, and logging preferences.

### Environment Setup

Create a `.env` file with the required environment variables as shown above.

### Running the Generator

Execute the application:

```bash
npm run start:original
```

## Logging and Monitoring

### Log Levels

The application supports multiple log levels for different types of information:

- `error`: Error messages and exceptions
- `warn`: Warning messages for potential issues
- `info`: General operational information
- `debug`: Detailed debugging information

### Log Files

Logs are automatically saved to `logs/app.log` in JSON format for easy parsing and analysis.

### Real-time Statistics

During execution, the application displays real-time information including:

- Progress tracking
- Success rates
- Processing speed metrics
- Error statistics
- Proxy server status

## Technical Details

### Retry System

The retry mechanism includes several sophisticated features:

- **Exponential Backoff**: Wait times increase exponentially after failures to reduce server load
- **Error Classification**: Automatically determines which errors are retryable
- **Queue Processing**: Failed operations are queued for later retry attempts

### Rate Limiting Protection

Advanced rate limiting features help avoid API blocks:

- **Dynamic Detection**: Automatically detects HTTP 429 rate limit responses
- **Automatic Adjustment**: Implements cooldown periods when rate limits are encountered
- **Burst Control**: Prevents excessive requests in short time periods

### Batch Processing

Efficient data handling through batch operations:

- **Asynchronous Saving**: Account data is saved in batches to improve performance
- **Memory Efficiency**: Optimized memory usage even with large datasets
- **Automatic Flushing**: Periodic automatic saves ensure data integrity

### Proxy Management

Robust proxy handling capabilities:

- **Health Checking**: Regular monitoring of proxy server availability
- **Automatic Rotation**: Switches to healthy proxies when issues are detected
- **Load Distribution**: Balances requests across multiple proxy servers

## Performance Improvements

### Before vs After Comparison

| Feature | Original | Enhanced |
|---------|----------|----------|
| Error Handling | Basic | Comprehensive |
| Retry Logic | None | Exponential backoff |
| Rate Limiting | None | Dynamic adjustment |
| Logging | Console only | Structured JSON logs |
| Storage | Synchronous writes | Batch processing |
| Proxy Management | Single/random | Health-checked rotation |

## Troubleshooting

### Common Issues

**Proxy Errors**
- Verify proxy configuration in environment variables
- Enable health checking in the configuration file

**Rate Limit Errors**  
- Adjust rate limiting settings in `config.json`
- Reduce the number of concurrent operations

**Memory Issues**
- Decrease batch size in configuration
- Lower the maximum concurrent account creation limit

### Debug Mode

Enable detailed debugging output:

```bash
DEBUG=true npm run start:original
```

## Temporary Email Service

The generator uses temporary email services for account verification. The current service endpoint is: https://www.emailnator.com/

## License

ISC License

## Contributing

Pull requests and issue reports are welcome. Please ensure your contributions follow the existing code style and include appropriate tests where applicable.


