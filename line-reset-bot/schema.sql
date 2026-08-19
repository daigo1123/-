-- D1データベース line-reset-bot のスキーマ（2026-08-18 適用済み）

-- 友だち追加してくれたユーザー（基本は自分ひとり）
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

-- 回答本体。1日 × 1質問 で1行
CREATE TABLE IF NOT EXISTS answers (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,          -- JSTの日付 YYYY-MM-DD
  question_key TEXT NOT NULL,  -- m1, m2, d1..d4, n1..n6, n5y/n5m/n5t, s1..s3
  answer TEXT NOT NULL,
  answered_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date, question_key)
);

-- いまどの質問への回答待ちか（質問キーの配列をJSONで保持）
-- queue_date は、その回答をどの日付として保存するか（過去日の記入に対応するため）
CREATE TABLE IF NOT EXISTS state (
  user_id TEXT PRIMARY KEY,
  queue TEXT NOT NULL DEFAULT '[]',
  queue_date TEXT,
  updated_at TEXT NOT NULL
);
