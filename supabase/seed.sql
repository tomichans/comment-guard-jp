-- [Supabase固有] このファイルは `supabase db reset` のときに、マイグレーションの後で自動実行される
-- （supabase/config.toml の [db.seed]）。本番DBには自動では流れない。

-- 媒体情報。MVPは YouTube のみ（要件定義書2.1）。
INSERT INTO sources (name, base_url, api_notes) VALUES
('youtube', 'https://www.googleapis.com/youtube/v3', 'YouTube Data API v3。commentThreads.list は1リクエスト最大100スレッド、nextPageToken でページング。');

-- NGワード辞書の初期データ（要件定義書9.2）。
-- severity=5 は即 harmful 確定、1〜4 は分類LLMへのヒント。
-- 運用中の追加・修正は Supabase Studio（Table Editor）で直接行う。
INSERT INTO ng_words (word, category, severity, normalized) VALUES
('死ね', '誹謗', 5, 'しね'),
('氏ね', '誹謗', 5, 'しね'),
('消えろ', '誹謗', 5, 'きえろ'),
('殺すぞ', '暴力', 4, 'ころすぞ'),
('ゴミ', '誹謗', 3, 'ごみ'),
('クズ', '誹謗', 3, 'くず'),
('カス', '誹謗', 3, 'かす'),
('殺す', '暴力', 2, 'ころす'),
('うざい', '誹謗', 1, 'うざい'),
('きもい', '誹謗', 1, 'きもい');
