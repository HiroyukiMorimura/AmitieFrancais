/* eslint-disable no-console */
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import "dotenv/config";

// ---------- 設定 ----------
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------- ユーティリティ ----------
type Pair = { ja: string; fr: string };

function readText(filePath: string): string {
  const abs = path.resolve(filePath);
  return fs.readFileSync(abs, "utf8");
}

// ヘッダ行から「仏「◯◯」」を抽出
function extractSubtopic(firstLine: string): string | null {
  const m = firstLine.match(/「(.+?)」/);
  return m ? m[1].trim() : null;
}

// 1行を JA / FR に分割（最初のラテン文字の位置でスプリット）
function splitJaFr(line: string): Pair | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // 先頭がコメントや絵文字っぽい場合はスキップ
  if (/^[#・＊*🇯🇵🇫🇷]/u.test(trimmed)) return null;

  const latinIdx = trimmed.search(/[A-Za-zÀ-ÿ]/u);
  if (latinIdx <= 0) return null;

  const ja = trimmed.slice(0, latinIdx).trim();
  const fr = trimmed.slice(latinIdx).trim();

  if (!ja || !fr) return null;

  // 末尾の全角スペース等を除去
  return { ja, fr: fr.replace(/\s+/g, " ") };
}

// テキスト全体をパース
function parseInput(text: string): {
  maybeSubtopic: string | null;
  pairs: Pair[];
} {
  const lines = text.split(/\r?\n/);
  const maybeSubtopic = lines.length ? extractSubtopic(lines[0]) : null;

  const pairs: Pair[] = [];
  for (const line of lines.slice(1)) {
    const p = splitJaFr(line);
    if (p) pairs.push(p);
  }
  return { maybeSubtopic, pairs };
}

// ---------- DB 操作（UPSERT） ----------
async function upsertTopic(bigCategory: string, subtopic: string) {
  const { data, error } = await supabase
    .from("topics")
    .upsert(
      { big_category: bigCategory, subtopic },
      { onConflict: "big_category,subtopic" }
    )
    .select()
    .single();

  if (error) throw error;
  return data.id as number;
}

async function upsertPair(topicId: number, p: Pair) {
  const { data, error } = await supabase
    .from("vocab_pairs")
    .upsert(
      { topic_id: topicId, ja: p.ja, fr: p.fr },
      { onConflict: "topic_id,ja,fr" }
    )
    .select()
    .single();

  if (error) throw error;
  return data.id as number;
}

async function ensureCard(pairId: number, direction: "JA2FR" | "FR2JA") {
  const { error } = await supabase
    .from("cards")
    .upsert(
      { pair_id: pairId, direction },
      { onConflict: "pair_id,direction", ignoreDuplicates: true }
    );
  if (error) throw error;
}

async function main() {
  // 例: npm run ingest -- --file data/2025-09-06.txt --category 政治 --subtopic 倫理的代理母制度
  const argv = process.argv.slice(2);
  const getArg = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const file = getArg("file");
  const bigCategory = getArg("category");
  let subtopic = getArg("subtopic");

  if (!file || !bigCategory) {
    console.error(
      "使い方: npm run ingest -- --file <path> --category <大項目> [--subtopic <小項目>]"
    );
    process.exit(1);
  }

  const raw = readText(file);
  const { maybeSubtopic, pairs } = parseInput(raw);

  if (!subtopic) subtopic = maybeSubtopic ?? "未分類";

  console.log(
    `📥 取り込み開始: 大項目=${bigCategory} / 小項目=${subtopic} / ペア数=${pairs.length}`
  );
  if (pairs.length === 0) {
    console.warn(
      "警告: 語彙ペアが見つかりませんでした。入力フォーマットを確認してください。"
    );
    process.exit(0);
  }

  const topicId = await upsertTopic(bigCategory, subtopic);

  let inserted = 0;
  for (const p of pairs) {
    try {
      const pairId = await upsertPair(topicId, p);
      await ensureCard(pairId, "JA2FR");
      await ensureCard(pairId, "FR2JA");
      inserted++;
    } catch (e) {
      console.warn("スキップ:", p, e);
    }
  }

  console.log(
    `✅ 完了: ${inserted}/${pairs.length} 件を登録（双方向カード自動作成）`
  );
}

main().catch((e) => {
  console.error("❌ エラー:", e);
  process.exit(1);
});
