-- 回答を見返すためのSQL集
--
-- 使い方：
--   Cloudflareダッシュボード → ストレージとデータベース → D1
--   → line-reset-bot → 「コンソール」タブ
--   に、下のブロックを1つだけ貼って実行する（複数まとめて貼らないこと）

------------------------------------------------------------
-- ① 日ごとの記入状況（まずこれで全体を把握する）
------------------------------------------------------------
SELECT date AS 日付, COUNT(*) AS 回答数, 17 - COUNT(*) AS 未回答数
FROM answers
GROUP BY date
ORDER BY date DESC;


------------------------------------------------------------
-- ② ある1日の記録を、テンプレートの順に全部表示する
--    '2026-08-18' の部分を見たい日付に変える
------------------------------------------------------------
SELECT
  CASE question_key
    WHEN 'm1'  THEN '朝① 5年後のバッドエンド'
    WHEN 'm2'  THEN '朝② 3年後のハッピーエンド'
    WHEN 'd1'  THEN '昼① 避けていること'
    WHEN 'd2'  THEN '昼② 他人から見た午前の行動'
    WHEN 'd3'  THEN '昼③ どちらに向かっているか'
    WHEN 'd4'  THEN '昼④ 実は一番重要なこと'
    WHEN 'n1'  THEN '夜① 生きていると感じた瞬間'
    WHEN 'n2'  THEN '夜② 死んでいると感じた瞬間'
    WHEN 'n3'  THEN '夜③ バッドエンド一行要約'
    WHEN 'n4'  THEN '夜④ ハッピーエンド一行要約'
    WHEN 'n5y' THEN '夜⑤ 1年後の目標'
    WHEN 'n5m' THEN '夜⑤ 1か月後の目標'
    WHEN 'n5t' THEN '夜⑤ 明日の目標'
    WHEN 'n6'  THEN '夜⑥ 真の敵の名前'
    WHEN 's1'  THEN '縛り① 意識すること'
    WHEN 's2'  THEN '縛り② 傾いたときの切り替え'
    WHEN 's3'  THEN '縛り③ 再スタートの仕方'
  END AS 質問,
  answer AS 回答
FROM answers
WHERE date = '2026-08-18'
ORDER BY
  CASE question_key
    WHEN 'm1' THEN 1  WHEN 'm2' THEN 2  WHEN 'd1' THEN 3  WHEN 'd2' THEN 4
    WHEN 'd3' THEN 5  WHEN 'd4' THEN 6  WHEN 'n1' THEN 7  WHEN 'n2' THEN 8
    WHEN 'n3' THEN 9  WHEN 'n4' THEN 10 WHEN 'n5y' THEN 11 WHEN 'n5m' THEN 12
    WHEN 'n5t' THEN 13 WHEN 'n6' THEN 14 WHEN 's1' THEN 15 WHEN 's2' THEN 16
    WHEN 's3' THEN 17
  END;


------------------------------------------------------------
-- ③ 特定の問いだけを時系列で並べる（変化を見る）
--    question_key を変えれば別の問いも追える
--      n6  = 真の敵の名前
--      n5t = 明日の目標
--      d1  = 避けていること
--      d3  = どちらに向かっているか
------------------------------------------------------------
SELECT date AS 日付, answer AS 回答
FROM answers
WHERE question_key = 'n6'
ORDER BY date DESC;


------------------------------------------------------------
-- ④ 全期間の記録を新しい順にざっと眺める
------------------------------------------------------------
SELECT date AS 日付, question_key AS 質問, answer AS 回答
FROM answers
ORDER BY date DESC, answered_at DESC;


------------------------------------------------------------
-- ⑤ キーワードで過去の回答を検索する
--    '大阪' の部分を探したい言葉に変える
------------------------------------------------------------
SELECT date AS 日付, question_key AS 質問, answer AS 回答
FROM answers
WHERE answer LIKE '%大阪%'
ORDER BY date DESC;


------------------------------------------------------------
-- ⑥ 記入もれの一覧（どの日のどの問いが空か）
------------------------------------------------------------
WITH ks(k, ord) AS (
  VALUES ('m1',1),('m2',2),('d1',3),('d2',4),('d3',5),('d4',6),
         ('n1',7),('n2',8),('n3',9),('n4',10),('n5y',11),('n5m',12),
         ('n5t',13),('n6',14),('s1',15),('s2',16),('s3',17)
)
SELECT d.date AS 日付, ks.k AS 未回答の質問
FROM (SELECT DISTINCT date FROM answers) d
CROSS JOIN ks
LEFT JOIN answers a ON a.date = d.date AND a.question_key = ks.k
WHERE a.question_key IS NULL
ORDER BY d.date DESC, ks.ord;
