export type LocalTopic = {
  id: number;
  big_category: string; // ← フォルダ名から決定
  subtopic: string; // ← ファイル先頭の「…」から決定
  created_at: string;
};
export type LocalPair = { id: number; ja: string; fr: string };

// news-sets 配下のすべてのサブフォルダを対象
const modules = import.meta.glob("/src/data/news-sets/**/*.txt", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const paths = Object.keys(modules).sort();
const baseId = -1000;
const idByPath = new Map<string, number>();
const pathById = new Map<number, string>();
paths.forEach((p, i) => {
  const id = baseId - i;
  idByPath.set(p, id);
  pathById.set(id, p);
});

export const LOCAL_PAIR_BLOCK = 100_000;

export function makeLocalPairId(topicId: number, rowIndex: number) {
  return topicId * LOCAL_PAIR_BLOCK - (rowIndex + 1);
}

// === ヘルパ ===
function extractSubtopicHeader(firstLine: string): string {
  const m = firstLine.match(/「(.+?)」/);
  if (m) return m[1].trim();
  return firstLine.replace(/[「」]/g, "").trim();
}

// 親ディレクトリ名から大項目
function getFolderKey(p: string): string {
  const m = p.match(/\/src\/data\/news-sets\/([^/]+)\//);
  return m ? m[1] : "misc";
}

// 英語フォルダ名 → 日本語カテゴリに変換
const FOLDER_TO_JA: Record<string, string> = {
  politics: "政治",
  economy: "経済",
  "tech-science": "テクノロジー・科学",
  health: "医療",
  law: "法律",
  education: "教育",
  environment: "環境",
  international: "国際",
  france: "フランス",
  japan: "日本",
  tourisme: "観光",
};

// 装飾/国旗行のスキップ
function isDecorativeHead(line: string): boolean {
  return /^(?:[#・＊*]|\p{RI}\p{RI})/u.test(line);
}

// JA/FR 分割
function splitJaFr(rawLine: string): { ja: string; fr: string } | null {
  const line = rawLine.trim();
  if (!line) return null;
  if (isDecorativeHead(line)) return null;

  const latinIdx = line.search(/[A-Za-zÀ-ÿœŒæÆ]/u);
  if (latinIdx <= 0) return null;

  const ja = line.slice(0, latinIdx).trim();
  const fr = line.slice(latinIdx).trim().replace(/\s+/g, " ");
  if (!ja || !fr) return null;
  return { ja, fr };
}

// === 公開API ===
export function listLocalTopics(): LocalTopic[] {
  return paths.map((p) => {
    const content = modules[p];
    const lines = content.trim().split(/\r?\n/);
    const header = lines[0] ?? "";

    const folder = getFolderKey(p).toLowerCase();
    const big = FOLDER_TO_JA[folder] ?? "時事";
    const sub = extractSubtopicHeader(header);

    return {
      id: idByPath.get(p)!,
      big_category: big,
      subtopic: sub,
      created_at: "",
    };
  });
}

export function isLocalTopicId(id: number): boolean {
  return pathById.has(id);
}

export async function loadLocalPairs(topicId: number): Promise<LocalPair[]> {
  const path = pathById.get(topicId);
  if (!path) return [];
  const content = modules[path];
  const lines = content.trim().split(/\r?\n/).slice(1);

  const pairs: LocalPair[] = [];
  for (const [i, line] of lines.entries()) {
    const p = splitJaFr(line);
    if (p)
      pairs.push({
        id: makeLocalPairId(topicId, i),
        ja: p.ja,
        fr: p.fr,
      });
  }
  return pairs;
}
