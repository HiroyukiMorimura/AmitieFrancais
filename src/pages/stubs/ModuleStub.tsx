import { recordAttempt, Skill, type ModuleId } from "../../lib/metrics";
import { useAuth } from "../../hooks/useAuth";

export default function ModuleStub({
  moduleId,
  title,
  defaultTags,
}: {
  moduleId: ModuleId;
  title: string;
  defaultTags: string[]; // そのモジュールの代表スキル
}) {
  const { user } = useAuth();

  const log = (ok: boolean) => {
    recordAttempt({
      userId: user!.id,
      moduleId,
      skillTags: defaultTags,
      correct: ok,
      meta: { stub: true },
    });
    alert(ok ? "正解を記録しました" : "不正解を記録しました");
  };

  return (
    <div className="min-h-svh grid place-items-center bg-slate-50">
      <div className="w-[min(92vw,720px)] rounded-2xl border bg-white p-6 shadow">
        <h1 className="text-xl font-bold">{title}（スタブ）</h1>
        <p className="mt-2 text-slate-600 text-sm">
          本実装の前に、正解/不正解の記録だけ確認できます。
        </p>

        <div className="mt-4 flex gap-2">
          <button
            className="btn-primary rounded-3xl px-5 py-3"
            onClick={() => log(true)}
          >
            正解にする
          </button>
          <button className="chip" onClick={() => log(false)}>
            不正解にする
          </button>
        </div>

        <div className="mt-4 text-xs text-slate-500">
          付与タグ: {defaultTags.join(", ")}
        </div>
      </div>
    </div>
  );
}

// 利便のためのエイリアス
export function NewsVocabStub() {
  return (
    <ModuleStub
      moduleId="news-vocab"
      title="① 時事単語"
      defaultTags={[Skill.VocabNews]}
    />
  );
}
export function NominalisationStub() {
  return (
    <ModuleStub
      moduleId="nominalisation"
      title="② 名詞化ジム"
      defaultTags={[Skill.Nominalisation]}
    />
  );
}
export function VerbGymStub() {
  return (
    <ModuleStub
      moduleId="verb-gym"
      title="③ 動詞選択＋活用"
      defaultTags={[Skill.VerbChoice, Skill.Conjugation]}
    />
  );
}
export function FreewriteStub() {
  return (
    <ModuleStub
      moduleId="freewrite"
      title="④ 自由作文ループ"
      defaultTags={[Skill.Agreement, Skill.Preposition, Skill.Article]}
    />
  );
}
