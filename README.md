# Yay Account Generator (Enhanced)

改善されたYayアカウント生成ツールです。リトライ機能、レート制限対策、構造化ログ、設定ファイル、バッチ処理などの機能を追加しています。

## 🚀 新機能

### ✅ 実装済み改善点

1. **リトライ機能** - 指数バックオフによる自動リトライ
2. **レート制限対策** - 動的レート制限検出と調整
3. **構造化ログ** - JSON形式のログとファイル出力
4. **設定ファイル** - 外部設定ファイルによる柔軟な設定
5. **バッチ処理** - 非同期バッチ処理によるパフォーマンス向上
6. **プロキシ管理** - ヘルスチェックと自動ローテーション
7. **エラーハンドリング** - 包括的なエラー処理と分類

## 📁 ファイル構成

```
yay_account-generator/
├── config.json                 # 設定ファイル
├── index-enhanced.js           # 改善されたメインアプリケーション
├── index.js                    # 元のアプリケーション
├── utils/
│   ├── logger.js               # 構造化ログ機能
│   ├── rate-limiter.js         # レート制限管理
│   ├── retry.js                # リトライ機能
│   ├── storage-manager.js      # バッチ処理ストレージ
│   ├── proxy-manager.js        # プロキシ管理
│   └── api-enhanced.js         # 改善されたAPIクライアント
├── TempGmail/
│   ├── enhanced.js             # 改善されたTempGmail
│   └── index.js                # 元のTempGmail
└── logs/                       # ログファイル出力先
```

## ⚙️ 設定

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

### 環境変数

```bash
# 必須
XSRF_TOKEN=your_xsrf_token
COOKIE=your_cookie
YAY_API_HOST=https://api.yay.space
USER_AGENT=your_user_agent
API_KEY=your_api_key
SIGNED_INFO=your_signed_info

# MongoDB使用時
MONGODB_URI=mongodb://localhost:27017/yay_accounts

# プロキシ（オプション）
PROXY_URL=http://proxy.example.com:8080
```

## 🚀 使用方法

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 設定ファイルの準備

`config.json`を必要に応じて編集してください。

### 3. 環境変数の設定

`.env`ファイルを作成し、必要な環境変数を設定してください。

### 4. 実行

#### 改善版の実行
```bash
node index-enhanced.js
```

#### 元のバージョンの実行
```bash
node index.js
```

## 📊 ログとモニタリング

### ログレベル

- `error`: エラー情報
- `warn`: 警告情報
- `info`: 一般情報
- `debug`: デバッグ情報

### ログファイル

ログは`logs/app.log`にJSON形式で保存されます。

### リアルタイム統計

実行中に以下の情報が表示されます：

- 進捗状況
- 成功率
- 処理速度
- エラー統計
- プロキシ状態

## 🔧 機能詳細

### リトライ機能

- **指数バックオフ**: 失敗時に待機時間を指数関数的に増加
- **エラー分類**: リトライ可能なエラーを自動判定
- **キュー処理**: 失敗した操作を後で再試行

### レート制限対策

- **動的検出**: 429エラーを自動検出
- **自動調整**: レート制限時に自動的にクールダウン
- **バースト制限**: 短時間での大量リクエストを制御

### バッチ処理

- **非同期保存**: アカウント情報をバッチで非同期保存
- **メモリ効率**: 大量データでもメモリ使用量を抑制
- **自動フラッシュ**: 定期的な自動保存

### プロキシ管理

- **ヘルスチェック**: プロキシの健全性を定期的に確認
- **自動ローテーション**: 問題のあるプロキシを自動的に切り替え
- **負荷分散**: 複数プロキシでの負荷分散

## 📈 パフォーマンス改善

### 改善前 vs 改善後

| 項目 | 改善前 | 改善後 |
|------|--------|--------|
| エラーハンドリング | 基本的 | 包括的 |
| リトライ機能 | なし | 指数バックオフ |
| レート制限対策 | なし | 動的調整 |
| ログ機能 | コンソールのみ | 構造化ログ |
| ストレージ | 同期書き込み | バッチ処理 |
| プロキシ管理 | 単一/ランダム | ヘルスチェック付き |

## 🛠️ トラブルシューティング

### よくある問題

1. **プロキシエラー**
   - プロキシの設定を確認
   - ヘルスチェックを有効化

2. **レート制限エラー**
   - `config.json`でレート制限設定を調整
   - 同時実行数を減らす

3. **メモリ不足**
   - バッチサイズを小さくする
   - 同時実行数を減らす

### デバッグモード

```bash
DEBUG=true node index-enhanced.js
```

## 📝 ライセンス

ISC License

## 🤝 貢献

プルリクエストやイシューの報告を歓迎します。


