-- スマレジ商品価格を販売管理で使うための products 価格列追加案
-- まだ実行しないでください。Supabase SQL Editorで確認後に実行してください。

alter table public.products
  add column if not exists price integer not null default 0;

comment on column public.products.price is
  'スマレジ商品取込時に取得した税込販売単価。販売管理の見積明細初期単価に使用。';
