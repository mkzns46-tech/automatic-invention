-- change_product_barcode v1 (2026-10-02)
-- スマレジ商品マスター取込で「スマレジ商品IDは一致するがバーコードが違う」商品の
-- ARICO バーコードを、スマレジ側（後優先）に付け替える。
--
-- 1つのトランザクションで：
--   1. 新バーコードが数字13桁で、どの商品にも使われていないことを確認（使われていれば停止）
--   2. 商品行を新バーコードで複製（在庫・棚番などの値はそのまま）
--   3. public スキーマの全テーブルの barcode 列（と products を参照する外部キー列、
--      バーコードを入れている product_id 列）を旧 → 新へ付け替え
--   4. 旧バーコードの商品行を削除
--   5. inventory_logs に「バーコード変更 旧 → 新」を1行残す（数量0）
-- 途中で失敗した場合はすべて取り消される。
-- 再実行しても安全（CREATE OR REPLACE）。不要になったら drop function public.change_product_barcode(text,text,text);

CREATE OR REPLACE FUNCTION public.change_product_barcode(p_old text, p_new text, p_staff text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old text:=trim(coalesce(p_old,''));
  v_new text:=trim(coalesce(p_new,''));
  v_staff text:=coalesce(nullif(trim(coalesce(p_staff,'')),''),'商品マスター取込');
  v_stock integer;
  v_name text;
  v_rows integer;
  v_total integer:=0;
  v_detail jsonb:='{}'::jsonb;
  r record;
begin
  if v_old='' or v_new='' then raise exception 'barcode is required'; end if;
  if v_new !~ '^[0-9]{13}$' then raise exception 'new barcode must be 13 digits: %',v_new; end if;
  if v_old=v_new then raise exception 'old and new barcode are the same: %',v_old; end if;

  select base_stock,name into v_stock,v_name from public.products where barcode=v_old for update;
  if not found then raise exception 'product not found: %',v_old; end if;
  if exists(select 1 from public.products where barcode=v_new) then
    raise exception 'new barcode is already used by another product: %',v_new;
  end if;

  -- 新バーコードの商品行を作る（列が増えても追従するよう JSON で複製）
  insert into public.products
  select (jsonb_populate_record(null::public.products, to_jsonb(p)||jsonb_build_object('barcode',v_new))).*
  from public.products p where p.barcode=v_old;

  -- 関連データの付け替え
  for r in
    select distinct t.tbl, t.col from (
      -- 文字列型の barcode 列を持つ全テーブル
      select c.relname::text as tbl, a.attname::text as col
      from pg_attribute a
      join pg_class c on c.oid=a.attrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relname<>'products'
        and a.attnum>0 and not a.attisdropped and a.attname='barcode'
        and format_type(a.atttypid,a.atttypmod) in ('text','character varying')
      union
      -- products を参照する外部キー列
      select c.relname::text, a.attname::text
      from pg_constraint k
      join pg_class c on c.oid=k.conrelid
      join pg_namespace n on n.oid=c.relnamespace
      join pg_attribute a on a.attrelid=k.conrelid and a.attnum=any(k.conkey)
      where k.contype='f' and k.confrelid='public.products'::regclass and n.nspname='public'
      union
      -- product_id にバーコードを入れているテーブル（smaregi_stock_* の product_id はスマレジIDなので対象外）
      select c.relname::text, a.attname::text
      from pg_attribute a
      join pg_class c on c.oid=a.attrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r'
        and c.relname in ('product_locations','product_location_logs','inventory_count_items')
        and a.attname='product_id' and a.attnum>0 and not a.attisdropped
        and format_type(a.atttypid,a.atttypmod) in ('text','character varying')
    ) t
  loop
    execute format('update public.%I set %I=$1 where %I=$2', r.tbl, r.col, r.col) using v_new, v_old;
    get diagnostics v_rows=row_count;
    if v_rows>0 then
      v_detail:=v_detail||jsonb_build_object(r.tbl||'.'||r.col, v_rows);
      v_total:=v_total+v_rows;
    end if;
  end loop;

  delete from public.products where barcode=v_old;

  insert into public.inventory_logs(type,staff,barcode,product_name,quantity,memo,affects_smaregi,smaregi_delta,before_stock,after_stock)
  values('在庫修正',v_staff,v_new,coalesce(v_name,''),0,'バーコード変更 '||v_old||' → '||v_new||'（スマレジ商品マスター取込）',false,0,v_stock,v_stock);

  return jsonb_build_object('old',v_old,'new',v_new,'moved_rows',v_total,'detail',v_detail);
end;
$function$;
