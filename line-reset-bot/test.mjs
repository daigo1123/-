// 時計を固定して決定論的にテストする（JST 2026-08-18 17:20 = UTC 08:20）
const NOW = Date.parse("2026-08-18T08:20:00Z");
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [NOW])); }
  static now() { return NOW; }
};
globalThis.Date.parse = RealDate.parse;

const { __test: T } = await import("./test-target.mjs");
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };

// --- cron→セッション対応 ---
for (const [utc, jst] of Object.entries({ 0: 9, 2: 11, 3: 12, 6: 15, 8: 17, 12: 21 })) {
  const h = T.jstHour(RealDate.parse(`2026-08-18T${String(utc).padStart(2, "0")}:00:00Z`));
  ok(h === jst && !!T.SESSIONS[h], `UTC ${utc}時 → JST ${jst}時のセッション`);
}
const inSessions = T.SESSION_HOURS.flatMap((h) => T.SESSIONS[h].keys);
ok(inSessions.length === 17 && new Set(inSessions).size === 17, "全17問が重複なく登録");
ok(T.jstDate(RealDate.parse("2026-08-18T15:30:00Z")) === "2026-08-19", "JST深夜0時半は翌日扱い");

// --- 日付パース ---
ok(T.parseDateArg("きのう", NOW) === "2026-08-17", "「きのう」→ 前日");
ok(T.parseDateArg("おととい", NOW) === "2026-08-16", "「おととい」→ 2日前");
ok(T.parseDateArg("8/17", NOW) === "2026-08-17", "「8/17」");
ok(T.parseDateArg("8月17日", NOW) === "2026-08-17", "「8月17日」");
ok(T.parseDateArg("2026-08-17", NOW) === "2026-08-17", "「2026-08-17」");
ok(T.parseDateArg("12/31", NOW) === "2025-12-31", "未来になる日付は前年扱い");
ok(T.parseDateArg("あさって", NOW) === null, "解釈できない語はnull");

// --- 会話フローのエンドツーエンド ---
const store = { answers: new Map(), state: null };
const db = { prepare(sql) { return { bind(...a) { return {
  async all() {
    if (sql.includes("FROM answers")) { const [u,d]=a; return { results: [...store.answers.entries()].filter(([k])=>k.startsWith(`${u}|${d}|`)).map(([k,v])=>({question_key:k.split("|")[2],answer:v})) }; }
    if (sql.includes("FROM users")) return { results: [{ user_id: "u" }] };
    return { results: [] };
  },
  async first() {
    if (sql.includes("FROM state")) return store.state;
    if (sql.includes("FROM answers")) { const [u,d,k]=a; const v=store.answers.get(`${u}|${d}|${k}`); return v?{answer:v}:null; }
    return null;
  },
  async run() {
    if (sql.includes("INTO answers")) store.answers.set(`${a[0]}|${a[1]}|${a[2]}`, a[3]);
    if (sql.includes("INTO state")) store.state = { queue: a[1], queue_date: a[2] };
    return {};
  } }; } }; } };
const sent = [];
globalThis.fetch = async (u, init) => { sent.push(JSON.parse(init.body).messages.map(m=>m.text).join("\n")); return { ok: true, text: async()=>"" }; };
const env = { DB: db };
const say = async (t) => { sent.length=0; await T.handleEvent(env, {type:"message",message:{type:"text",text:t},source:{userId:"u"},replyToken:"r"}); return sent.join("\n"); };

// 昨日ぶんを最初から記入
let r = await say("スタート きのう");
ok(r.includes("2026-08-17") && r.includes("17問") && r.includes("朝①"), "「スタート きのう」→ 17問セットし朝①を出題");
let last = "";
for (let i = 0; i < 17; i++) last = await say(`回答${i}`);
ok(last.includes("2026-08-17 のぶん、記入おつかれさま"), "17問完了で昨日ぶんの完了メッセージ");
ok(last.includes("回答16") && last.includes("回答0"), "完了時に昨日ぶんのまとめ全文が返る");
ok(store.answers.size === 17 && [...store.answers.keys()].every(k=>k.includes("2026-08-17")), "17件すべて昨日の日付で保存");
ok((await say("スタート きのう")).includes("全問回答済み"), "回答済みの日に再スタート → 全問回答済み");
ok((await say("まとめ")).includes("記録はまだありません"), "今日の記録は空のまま（混ざらない）");
ok((await say("まとめ 8/17")).includes("回答0"), "「まとめ 8/17」で過去日の記録を表示");
ok((await say("修正 8/17 昼① 直した内容")).includes("2026-08-17 の【昼①】"), "「修正 8/17 昼① 〜」で過去日を修正");
ok(store.answers.get("u|2026-08-17|d1") === "直した内容", "修正が昨日ぶんに反映");
await say("修正 朝① 今日の修正");
ok(store.answers.get("u|2026-08-18|m1") === "今日の修正", "日付なしの修正は今日ぶんに入る");
ok((await say("スタート あさって")).includes("日付が読み取れませんでした"), "不正な日付はエラー案内");

// 途中まで回答済みの過去日は、残りだけを聞く
store.answers.delete("u|2026-08-17|n6");
store.answers.delete("u|2026-08-17|s2");
store.state = null;
r = await say("スタート 8/17");
ok(r.includes("未回答が2問") && r.includes("夜⑥"), `一部回答済みの過去日は残りだけ出題（${r.match(/未回答が(\d+)問/)?.[1]}問・先頭は夜⑥）`);

// 夜③④は朝の回答を引用するか
store.answers.set("u|2026-08-16|m1", "テスト用バッドエンド");
store.state = { queue: JSON.stringify(["n3"]), queue_date: "2026-08-16" };
ok((await say("いま")).includes("テスト用バッドエンド"), "夜③でその日の朝①を引用する");

console.log(fail === 0 ? "\n=== 全テスト成功 ===" : `\n=== ${fail}件 失敗 ===`);
process.exit(fail ? 1 : 0);
