# アミティエ学習アプリ

フランス語学習を楽しく続けるための Web アプリケーション

## 📖 概要

**アミティエ**（Amitié、フランス語で「友情」）は、フランス語学習者が実践的なスキルを身につけられるよう設計された学習支援アプリケーションです。ニュース単語、動詞活用、作文練習など、多様な学習モジュールを提供し、学習データを可視化して継続的な学習をサポートします。

### 主な特徴

✨ **多彩な学習モジュール**
- **時事単語**: ニュースに登場する重要単語を学習
- **名詞化ジム**: より洗練されたフランス語表現を習得
- **動詞ジム**: 動詞の活用と時制を徹底トレーニング
- **仏作文**: 日本語からフランス語への翻訳練習
- **仏検対策**: 実用フランス語技能検定試験（仏検）対策

📊 **学習の可視化**
- 総学習時間、学習日数、連続学習日数の追跡
- モジュール別の正答率とパフォーマンス分析
- 詳細なレポート機能で学習進捗を確認

🎨 **美しく使いやすいUI**
- パステルカラーを基調とした優しいデザイン
- レスポンシブデザインでスマートフォンにも対応
- 直感的な操作性と滑らかなアニメーション

🔐 **ユーザー管理とセキュリティ**
- Supabase を使用した安全な認証システム
- ユーザーごとのデータ管理
- セッション永続化とトークン自動更新

## 🛠️ 技術スタック

### フロントエンド
- **React 19** - UI フレームワーク
- **TypeScript** - 型安全な開発
- **Vite** - 高速なビルドツール
- **React Router** - クライアントサイドルーティング
- **TailwindCSS** - ユーティリティファーストの CSS フレームワーク
- **TanStack Query (React Query)** - サーバー状態管理

### バックエンド・データベース
- **Supabase** - BaaS（Backend as a Service）
  - PostgreSQL データベース
  - 認証・認可システム
  - リアルタイムデータ同期
  - ストレージ機能

### 開発ツール
- **ESLint** - コード品質管理
- **TypeScript ESLint** - TypeScript 専用の Lint ルール
- **Playwright** - E2E テスト
- **tsx** - TypeScript スクリプト実行

## 📂 プロジェクト構造

```
AmitieFrancais/
├── src/
│   ├── pages/              # ページコンポーネント
│   │   ├── Landing.tsx     # ランディングページ
│   │   ├── Login.tsx       # ログインページ
│   │   ├── Signup.tsx      # サインアップページ
│   │   ├── Hub.tsx         # ダッシュボード（ホーム）
│   │   ├── NewsVocab.tsx   # 時事単語モジュール
│   │   ├── Nominalisation.tsx  # 名詞化ジム
│   │   ├── Verbe.tsx       # 動詞ジム
│   │   ├── Composition.tsx # 仏作文モジュール
│   │   ├── Futsuken.tsx    # 仏検対策モジュール
│   │   ├── StudyTime.tsx   # 学習時間トラッキング
│   │   └── Report.tsx      # レポート画面
│   ├── components/         # 再利用可能なコンポーネント
│   ├── hooks/              # カスタム React フック
│   │   ├── useAuth.tsx     # 認証フック
│   │   └── ...
│   ├── lib/                # ユーティリティとライブラリ
│   │   ├── supabase.ts     # Supabase クライアント設定
│   │   └── supaMetrics.ts  # 学習データ取得関数
│   ├── routes/             # ルート設定
│   │   └── ProtectedRoute.tsx  # 認証保護されたルート
│   ├── providers/          # コンテキストプロバイダー
│   ├── data/               # 学習データ（TSV ファイル等）
│   │   ├── verbe/          # 動詞リスト
│   │   ├── news-sets/      # ニュース単語セット
│   │   ├── nominalisations/ # 名詞化問題
│   │   ├── Composition/    # 作文問題
│   │   └── Futsuken/       # 仏検問題
│   ├── App.tsx             # メインアプリコンポーネント
│   ├── main.tsx            # エントリーポイント
│   └── index.css           # グローバルスタイル
├── scripts/                # ユーティリティスクリプト
│   ├── ingest.ts           # データインポートスクリプト
│   ├── create-demo-user.ts # デモユーザー作成
│   └── ping.ts             # ヘルスチェック
├── public/                 # 静的ファイル
│   ├── images/             # 画像ファイル
│   └── data/               # 公開データファイル
├── .env                    # 環境変数（本番用）
├── .env.local              # 環境変数（ローカル開発用）
├── package.json            # npm 依存関係
├── tsconfig.json           # TypeScript 設定
├── vite.config.ts          # Vite 設定
├── tailwind.config.js      # TailwindCSS 設定
└── README.md               # このファイル
```

## 🚀 セットアップ

### 必要要件

- **Node.js** 18.x 以上
- **npm** 9.x 以上
- **Supabase アカウント**（[supabase.com](https://supabase.com) で無料登録可能）

### インストール手順

1. **リポジトリのクローン**
```bash
git clone https://github.com/HiroyukiMorimura/AmitieFrancais.git
cd AmitieFrancais
```

2. **依存関係のインストール**
```bash
npm install
```

3. **環境変数の設定**

プロジェクトルートに `.env.local` ファイルを作成し、以下の環境変数を設定します：

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

> **補足**: Supabase の URL と Anon Key は、Supabase プロジェクトの設定画面（Settings > API）から取得できます。

4. **Supabase データベースのセットアップ**

Supabase プロジェクトにログインし、以下のテーブルを作成します：

- `user_activity` - ユーザーの学習アクティビティ記録
- `daily_study` - 日別の学習時間
- その他必要なテーブル（詳細はプロジェクトのデータスキーマを参照）

5. **開発サーバーの起動**
```bash
npm run dev
```

ブラウザで `http://localhost:5173` を開いてアプリケーションにアクセスします。

## 📝 使い方

### ユーザー登録とログイン

1. アプリケーションを開き、「新規登録」をクリック
2. メールアドレスとパスワードを入力して登録
3. 登録後、自動的にダッシュボードにリダイレクト

### 学習モジュールの利用

ダッシュボードから各学習モジュールを選択：

- **時事単語**: カードをめくって単語と意味を確認し、正解/不正解を記録
- **名詞化ジム**: 動詞や形容詞を名詞形に変換する練習
- **動詞ジム**: 指定された時制で動詞を活用させる問題
- **仏作文**: 日本語の文章をフランス語に翻訳

### 学習データの確認

- **ダッシュボード**: 学習時間、連続日数、総正答数などを一目で確認
- **レポート画面**: より詳細な学習データとグラフを表示

## 🧪 テスト

### E2E テスト（Playwright）

動詞ジムモジュールのテストを実行：

```bash
# ヘッドレスモード
npm run test:verbe

# UI モード（デバッグ用）
npm run test:verbe:ui
```

## 🔧 開発スクリプト

```bash
# 開発サーバー起動
npm run dev

# ビルド（本番用）
npm run build

# ビルドしたアプリのプレビュー
npm run preview

# ESLint によるコードチェック
npm run lint

# データインポート
npm run ingest

# デモユーザー作成
npm run create-demo-user
```

## 📊 学習データの管理

### データインポート

`src/data/` ディレクトリ内の TSV ファイルに学習データ（単語、動詞、問題）を追加できます。

データのインポートには以下のコマンドを使用：

```bash
npm run ingest
```

### データ形式

各モジュールのデータは TSV（タブ区切り）形式で管理されています：

- **動詞**: `src/data/verbe/` - 動詞の原形、意味、グループ分類
- **時事単語**: `src/data/news-sets/` - 単語セット（単語、品詞、意味）
- **名詞化**: `src/data/nominalisations/` - 名詞化問題
- **作文**: `src/data/Composition/` - 日仏翻訳問題

## 🎨 カスタマイズ

### UI テーマの変更

`tailwind.config.js` でカラーパレットをカスタマイズできます。

### 新しい学習モジュールの追加

1. `src/pages/` に新しいページコンポーネントを作成
2. `src/App.tsx` にルートを追加
3. `src/pages/Hub.tsx` のダッシュボードにカードを追加

## 🛡️ セキュリティ

- 環境変数（`.env`, `.env.local`）は Git にコミットしないでください
- Supabase の Row Level Security (RLS) を有効にし、適切なポリシーを設定してください
- 本番環境では、Supabase の Anon Key のみを使用し、Service Role Key は決してクライアントに公開しないでください

## 📄 ライセンス

このプロジェクトはプライベートプロジェクトです。

## 🤝 貢献

現在、このプロジェクトは個人開発プロジェクトです。

## 📞 お問い合わせ

プロジェクトに関する質問や提案がある場合は、GitHub Issues をご利用ください。

---

**Bon courage dans votre apprentissage du français! 🇫🇷**
