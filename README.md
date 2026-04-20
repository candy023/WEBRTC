# webrtc

このアプリケーションは、Gatherのようなオンライン会話ツールで、WebRTCを利用してリアルタイムでビデオ・音声通話を行うこを想定しています。
## 技術

- **フロントエンド**: Vue 3 + Vite
- **WebRTC**: SkyWay SDK
- **スタイリング**: **Tailwind CSS v4**
- **ビルドツール**: Vite
- **パッケージマネージャー**: npm

###条件

- **Node.js** (バージョン 18.0.0 以上推奨)
- **npm** (Node.jsに付属)
- **SkyWayアカウント** ([SkyWay](https://skyway.ntt.com/)で取得)

## ⚙️ 環境変数の設定
1. リポジトリのクローン
```bash
git clone https://github.com/candy023/WEBRTC.git
```
プロジェクトルートに `.env` ファイルを作成し、以下を設定：

```bash
# SkyWay設定
VITE_SKYWAY_APP_ID=your_skyway_app_id
VITE_SKYWAY_SECRET_KEY=your_skyway_secret_ke
```

# package.jsonに記載された全ての依存関係をインストール
```
bashnpm install
```
#ローカルでの起動
```
npm run dev
```


