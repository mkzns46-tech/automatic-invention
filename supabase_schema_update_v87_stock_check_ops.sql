-- v87追加SQL：実運用向けスマレジ棚卸し
-- Supabase SQL Editorで1回実行してください。

alter table public.smaregi_stock_items add column if not exists excluded_at timestamptz;
alter table public.smaregi_stock_items add column if not exists excluded_by text;
