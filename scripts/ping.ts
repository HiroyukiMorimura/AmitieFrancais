// scripts/ping.ts
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function headCount(table: string) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { head: true, count: "exact" });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function countCards(dir: "JA2FR" | "FR2JA") {
  const { count, error } = await supabase
    .from("cards")
    .select("*", { head: true, count: "exact" })
    .eq("direction", dir);
  if (error) throw new Error(`cards(${dir}): ${error.message}`);
  return count ?? 0;
}

(async () => {
  const topics = await headCount("topics");
  const pairs = await headCount("vocab_pairs");
  const cards = await headCount("cards");
  const ja2fr = await countCards("JA2FR");
  const fr2ja = await countCards("FR2JA");

  console.log({ topics, pairs, cards, ja2fr, fr2ja });
})();
