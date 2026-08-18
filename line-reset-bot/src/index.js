// LINE 人生立て直しBot — Cloudflare Worker
//
// - cron（定時）: その時間帯の質問を LINE に push 送信し、回答待ちキューをセットする
// - webhook: LINE からの返信を受け取り、待ち行列の先頭の質問への回答として D1 に保存する
// - 夜の最終問に答え終わると、その日の全回答のまとめを reply で返す（push を消費しない）
//
// 必要なシークレット: LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET
// 必要なバインディング: DB (D1: line-reset-bot)

const QUESTIONS = [
  { key: "m1", label: "朝①", text: "何も変えずに過ごしたら訪れるであろう、5年後のバッドエンドはどんな世界？" },
  { key: "m2", label: "朝②", text: "3年後に送りたいハッピーエンドはどんな世界？" },
  { key: "d1", label: "昼①", text: "今やっていることで「避けていること」は何？" },
  { key: "d2", label: "昼②", text: "今日の午前中の行動を他人が見たら、「この人は何を求めている」と思われる？" },
  { key: "d3", label: "昼③", text: "今、自分はハッピーエンドに向かっている？それともバッドエンドに向かっている？" },
  { key: "d4", label: "昼④", text: "一見重要でないように見えて、実は一番重要なことは何？" },
  { key: "n1", label: "夜①", text: "今日いちばん「生きている」と感じた瞬間は？" },
  { key: "n2", label: "夜②", text: "今日いちばん「死んでいる」と感じた瞬間は？" },
  { key: "n3", label: "夜③", text: "朝に書いたバッドエンドを一行で要約すると？" },
  { key: "n4", label: "夜④", text: "朝に書いたハッピーエンドを一行で要約すると？" },
  { key: "n5y", label: "夜⑤-1", text: "ハッピーエンドに向かうための「1年後の目標」は？（状況に応じて軌道修正しながら進めてOK）" },
  { key: "n5m", label: "夜⑤-2", text: "「1か月後の目標」は？" },
  { key: "n5t", label: "夜⑤-3", text: "「明日の目標」は？" },
  { key: "n6", label: "夜⑥", text: "真の敵（ハッピーエンドに向かう私を邪魔する“私の性質”）に名前をつけるとしたら？" },
  { key: "s1", label: "縛り①", text: "ハッピーエンド側に寄せるために意識することは？" },
  { key: "s2", label: "縛り②", text: "バッドエンド側に傾きそうになったとき、どう切り替える？" },
  { key: "s3", label: "縛り③", text: "それでもうまくいかなかった場合、どう再スタートする？" },
];

const QUESTION_BY_KEY = Object.fromEntries(QUESTIONS.map((q) => [q.key, q]));
const KEY_BY_LABEL = Object.fromEntries(QUESTIONS.map((q) => [q.label, q.key]));

// UTC時 → その時間帯のセッション（JST = UTC+9）
const SESSIONS = {
  0: { intro: "おはようございます☀️\n【朝】未来を頭の中に作る時間です。2問続けて聞きます。", keys: ["m1", "m2"] },
  2: { intro: null, keys: ["d1"] },
  3: { intro: null, keys: ["d2"] },
  6: { intro: null, keys: ["d3"] },
  8: { intro: null, keys: ["d4"] },
  12: {
    intro: "🌙 夜の振り返りの時間です。\n全11問、1問ずつ聞いていきます。最後まで答えると今日のまとめが届きます。",
    keys: ["n1", "n2", "n3", "n4", "n5y", "n5m", "n5t", "n6", "s1", "s2", "s3"],
  },
};

// セッション完了後、次の質問が来る時刻（JST）の案内
const NEXT_TIME = { m2: "11時", d1: "12時", d2: "15時", d3: "17時", d4: "21時" };

const HELP_TEXT =
  "いまは回答待ちの質問がありません🕐\n\n使えるコマンド：\n・「まとめ」→ 今日の記録を表示\n・「きのう」→ 昨日の記録を表示\n・「修正 朝① 新しい内容」→ 回答の書き直し\n・「いま」→ 回答待ちの質問をもう一度表示";

export default {
  async scheduled(controller, env, ctx) {
    const hour = new Date(controller.scheduledTime).getUTCHours();
    const session = SESSIONS[hour];
    if (!session) return;

    const date = jstDate(controller.scheduledTime);
    const { results: users } = await env.DB.prepare("SELECT user_id FROM users").all();

    for (const { user_id } of users) {
      await setQueue(env, user_id, session.keys);
      const messages = [];
      if (session.intro) messages.push({ type: "text", text: session.intro });
      messages.push({ type: "text", text: await questionText(env, user_id, session.keys[0], date) });
      await lineApi(env, "push", { to: user_id, messages });
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/webhook") {
      const body = await request.text();
      const ok = await verifySignature(env.LINE_CHANNEL_SECRET, body, request.headers.get("x-line-signature"));
      if (!ok) return new Response("bad signature", { status: 401 });

      const { events = [] } = JSON.parse(body);
      for (const ev of events) {
        try {
          await handleEvent(env, ev);
        } catch (e) {
          console.error("event error", e);
        }
      }
      return new Response("ok");
    }

    return new Response("line-reset-bot is running");
  },
};

async function handleEvent(env, ev) {
  const userId = ev.source && ev.source.userId;
  if (!userId) return;

  if (ev.type === "follow") {
    await upsertUser(env, userId);
    await lineApi(env, "reply", {
      replyToken: ev.replyToken,
      messages: [
        {
          type: "text",
          text:
            "友だち追加ありがとうございます👋\n毎日この時間に質問を送ります：\n\n☀️ 9時：朝の2問（未来を頭の中に作る）\n🕚 11・12・15・17時：昼の問い\n🌙 21時：夜の振り返り（全11問）\n\n夜の最後まで答えると、その日のまとめが届きます。\n回答はそのままメッセージで送ってください。",
        },
      ],
    });
    return;
  }

  if (ev.type === "unfollow") {
    await env.DB.prepare("DELETE FROM users WHERE user_id = ?").bind(userId).run();
    await env.DB.prepare("DELETE FROM state WHERE user_id = ?").bind(userId).run();
    return;
  }

  if (ev.type !== "message" || ev.message.type !== "text") return;

  await upsertUser(env, userId);
  const text = ev.message.text.trim();
  const date = jstDate(Date.now());

  // コマンド：まとめ
  if (text === "まとめ") {
    await reply(env, ev.replyToken, await buildSummary(env, userId, date));
    return;
  }
  if (text === "きのう") {
    await reply(env, ev.replyToken, await buildSummary(env, userId, jstDate(Date.now() - 24 * 3600 * 1000)));
    return;
  }

  // コマンド：修正 朝① 新しい内容
  const fix = text.match(/^修正\s+(\S+)\s+([\s\S]+)$/);
  if (fix) {
    const key = KEY_BY_LABEL[fix[1]];
    if (!key) {
      await reply(env, ev.replyToken, `「${fix[1]}」という質問が見つかりません。例：修正 朝① 新しい内容\n（朝①② / 昼①〜④ / 夜①〜④ / 夜⑤-1〜3 / 夜⑥ / 縛り①〜③）`);
      return;
    }
    await saveAnswer(env, userId, date, key, fix[2].trim());
    await reply(env, ev.replyToken, `✏️ 【${fix[1]}】の回答を修正しました。`);
    return;
  }

  const queue = await getQueue(env, userId);

  // コマンド：いま（回答待ちの質問を再表示）
  if (text === "いま") {
    if (queue.length === 0) {
      await reply(env, ev.replyToken, HELP_TEXT);
    } else {
      await reply(env, ev.replyToken, await questionText(env, userId, queue[0], date));
    }
    return;
  }

  // 通常の回答
  if (queue.length === 0) {
    await reply(env, ev.replyToken, HELP_TEXT);
    return;
  }

  const key = queue.shift();
  await saveAnswer(env, userId, date, key, text);
  await setQueue(env, userId, queue);

  if (queue.length > 0) {
    // 同じセッションの次の質問へ
    await reply(env, ev.replyToken, "✅ " + (await questionText(env, userId, queue[0], date)));
  } else if (key === "s3") {
    // 夜の最終問 → その日のまとめを返す
    await reply(env, ev.replyToken, "✅ 今日も全問おつかれさまでした！\n\n" + (await buildSummary(env, userId, date)));
  } else {
    const next = NEXT_TIME[key];
    await reply(env, ev.replyToken, `✅ 保存しました。${next ? `次は${next}に聞きます🕐` : ""}`);
  }
}

// ---- 質問文の組み立て ----

async function questionText(env, userId, key, date) {
  const q = QUESTION_BY_KEY[key];
  let text = `【${q.label}】\n${q.text}`;

  // 夜③④は朝の回答を引用して要約しやすくする
  const refKey = key === "n3" ? "m1" : key === "n4" ? "m2" : null;
  if (refKey) {
    const morning = await getAnswer(env, userId, date, refKey);
    if (morning) text += `\n\n（今朝の回答）\n${morning}`;
  }
  return text;
}

// ---- まとめ ----

async function buildSummary(env, userId, date) {
  const { results } = await env.DB.prepare(
    "SELECT question_key, answer FROM answers WHERE user_id = ? AND date = ?"
  )
    .bind(userId, date)
    .all();

  if (results.length === 0) return `📝 ${date} の記録はまだありません。`;

  const byKey = Object.fromEntries(results.map((r) => [r.question_key, r.answer]));
  const lines = [`📝 ${date} の記録`];
  for (const q of QUESTIONS) {
    lines.push("", `■${q.label} ${q.text}`, `→ ${byKey[q.key] ?? "（未回答）"}`);
  }

  let out = lines.join("\n");
  if (out.length > 4900) out = out.slice(0, 4900) + "…";
  return out;
}

// ---- D1 ----

async function upsertUser(env, userId) {
  await env.DB.prepare("INSERT OR IGNORE INTO users (user_id, created_at) VALUES (?, ?)")
    .bind(userId, new Date().toISOString())
    .run();
}

async function saveAnswer(env, userId, date, key, answer) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO answers (user_id, date, question_key, answer, answered_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(userId, date, key, answer, new Date().toISOString())
    .run();
}

async function getAnswer(env, userId, date, key) {
  const row = await env.DB.prepare(
    "SELECT answer FROM answers WHERE user_id = ? AND date = ? AND question_key = ?"
  )
    .bind(userId, date, key)
    .first();
  return row && row.answer;
}

async function getQueue(env, userId) {
  const row = await env.DB.prepare("SELECT queue FROM state WHERE user_id = ?").bind(userId).first();
  try {
    return row ? JSON.parse(row.queue) : [];
  } catch {
    return [];
  }
}

async function setQueue(env, userId, keys) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO state (user_id, queue, updated_at) VALUES (?, ?, ?)"
  )
    .bind(userId, JSON.stringify(keys), new Date().toISOString())
    .run();
}

// ---- LINE API ----

async function reply(env, replyToken, text) {
  await lineApi(env, "reply", { replyToken, messages: [{ type: "text", text }] });
}

async function lineApi(env, endpoint, body) {
  const res = await fetch(`https://api.line.me/v2/bot/message/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`LINE ${endpoint} failed: ${res.status} ${await res.text()}`);
  }
}

// ---- 署名検証（LINEからのリクエストであることの確認）----

async function verifySignature(secret, body, signature) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return expected === signature;
}

// ---- 日付（JST）----

function jstDate(ts) {
  return new Date(ts + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
