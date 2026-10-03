-- 2026-10-03 Excel で壊れたバーコード「2.9E+12」（シューティング トレーナー）の削除
-- 在庫0・価格0・スマレジ商品IDなし・どこからも参照なし。正しい行（2900000000377 / 2900000000117）は残る。
delete from public.products where barcode='2.9E+12' and coalesce(base_stock,0)=0 and smaregi_product_id is null returning barcode, name;
