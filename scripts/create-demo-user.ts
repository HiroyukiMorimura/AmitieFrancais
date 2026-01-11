/* eslint-disable no-console */
// scripts/create-demo-user.ts
// デモアカウントを作成または確認するスクリプト
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const DEMO_EMAIL = "demo@lingua.app";
const DEMO_PASSWORD = "demo1234";

async function main() {
  try {
    console.log("🔍 デモアカウントの存在確認中...");
    
    // ユーザー一覧を取得して、demo@lingua.appが存在するか確認
    const { data: users, error: listError } = await supabase.auth.admin.listUsers();
    
    if (listError) {
      console.error("❌ ユーザー一覧の取得に失敗しました:", listError.message);
      process.exit(1);
    }

    const demoUser = users.users.find((u) => u.email === DEMO_EMAIL);

    if (demoUser) {
      console.log("✅ デモアカウントは既に存在しています");
      console.log(`   ユーザーID: ${demoUser.id}`);
      console.log(`   メールアドレス: ${demoUser.email}`);
      console.log(`   作成日時: ${demoUser.created_at}`);
      return;
    }

    console.log("📝 デモアカウントが存在しないため、作成します...");

    // デモアカウントを作成
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true, // メール確認をスキップして即座に利用可能にする
    });

    if (createError) {
      console.error("❌ デモアカウントの作成に失敗しました:", createError.message);
      process.exit(1);
    }

    console.log("✅ デモアカウントを作成しました！");
    console.log(`   ユーザーID: ${newUser.user.id}`);
    console.log(`   メールアドレス: ${newUser.user.email}`);
    console.log(`   ログイン可能: ${newUser.user.email_confirmed_at ? "はい" : "いいえ"}`);
    console.log("\n📋 ログイン情報:");
    console.log(`   メールアドレス: ${DEMO_EMAIL}`);
    console.log(`   パスワード: ${DEMO_PASSWORD}`);
  } catch (error) {
    console.error("❌ エラーが発生しました:", error);
    process.exit(1);
  }
}

main();


