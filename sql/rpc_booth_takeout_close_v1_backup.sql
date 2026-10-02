-- 2026-10-02 時点の本番定義（バックアップ / ロールバック用）
-- v2 を適用して問題があった場合、このファイルを SQL Editor で実行すると元に戻る。

CREATE OR REPLACE FUNCTION public.confirm_booth_event_close(p_event_id uuid, p_staff text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  event_row public.booth_events%rowtype;
  item_row public.booth_event_items%rowtype;
  storage_row public.event_storage_stocks%rowtype;
  v_store text;
  v_now timestamptz:=now();
  v_before_base integer;
  v_after_base integer;
  v_before_event integer;
  v_after_event integer;
  v_returned integer;
  v_sold integer;
  v_consumed integer;
  v_unreturned integer;
  v_requested_out integer;
  v_actual_out integer;
  v_shortage integer;
  v_smaregi text;
  v_items integer:=0;
  v_return_qty integer:=0;
  v_unreturned_qty integer:=0;
  v_out_qty integer:=0;
begin
  if p_event_id is null then raise exception 'event_id is required'; end if;
  if coalesce(trim(p_staff),'')='' then raise exception 'staff is required'; end if;
  select * into event_row from public.booth_events where id=p_event_id for update;
  if not found then raise exception 'event not found'; end if;
  if lower(coalesce(event_row.status,'')) in ('closed','cancelled','canceled','invalid','deleted') then raise exception 'event is already closed'; end if;
  v_store:=lower(trim(coalesce(event_row.store_code,'')));
  if v_store='' then raise exception 'event store_code is missing'; end if;
  for item_row in
    select * from public.booth_event_items
    where event_id=p_event_id and item_type='normal' and coalesce(taken_qty,0)>0
    order by barcode for update
  loop
    v_returned:=greatest(0,coalesce(item_row.returned_qty,0));
    v_sold:=greatest(0,coalesce(item_row.sold_qty,0));
    v_consumed:=greatest(0,coalesce(item_row.consumed_qty,0));
    v_unreturned:=greatest(0,coalesce(item_row.taken_qty,0)-v_sold-v_returned-v_consumed);
    v_requested_out:=v_returned+v_unreturned;

    -- event_storage_qty is the current-event quantity. The shared
    -- event_storage_stocks row may contain stock belonging to other events;
    -- never use that shared total as this event's close quantity.
    v_before_event:=greatest(0,coalesce(item_row.event_storage_qty,0));
    if v_before_event>0 then
      select * into storage_row from public.event_storage_stocks
      where store_code=v_store and barcode=item_row.barcode for update;
      if not found then raise exception 'event storage stock not found: %',item_row.barcode; end if;
    else
      storage_row:=null;
    end if;
    v_actual_out:=least(v_before_event,v_requested_out);
    v_after_event:=v_before_event-v_actual_out;
    v_shortage:=greatest(0,v_requested_out-v_actual_out);

    select base_stock into v_before_base from public.products where barcode=item_row.barcode for update;
    if not found then raise exception 'product not found: %',item_row.barcode; end if;
    v_before_base:=coalesce(v_before_base,0);
    select smaregi_product_id into v_smaregi from public.products where barcode=item_row.barcode;

    if v_returned>0 then
      v_after_base:=v_before_base+v_returned;
      update public.products set base_stock=v_after_base where barcode=item_row.barcode;
      insert into public.inventory_logs(type,staff,barcode,product_name,quantity,memo,event_id,affects_smaregi,smaregi_delta,store_code,inventory_scope,before_stock,after_stock,event_shelf_before,event_shelf_after)
      values('在庫修正',p_staff,item_row.barcode,coalesce(item_row.product_name,''),v_returned,'イベント締め / 戻り棚卸実数を通常棚へ反映',p_event_id,false,0,v_store,'normal',v_before_base,v_after_base,v_before_event,v_after_event);
      v_return_qty:=v_return_qty+v_returned;
    end if;
    if v_actual_out>0 then
      update public.event_storage_stocks set storage_qty=storage_row.storage_qty-v_actual_out,updated_at=v_now where id=storage_row.id;
      insert into public.event_storage_movements(event_id,store_code,smaregi_product_id,barcode,product_name,movement_type,quantity,staff,memo,before_qty,after_qty)
      values(p_event_id,v_store,coalesce(v_smaregi,item_row.barcode),item_row.barcode,coalesce(item_row.product_name,''),'storage_out',v_actual_out,p_staff,case when v_unreturned>0 then 'イベント締め / イベント棚を通常棚へ戻す / 未帰還'||v_unreturned else 'イベント締め / イベント棚を通常棚へ戻す' end,v_before_event,v_after_event);
      v_out_qty:=v_out_qty+v_actual_out;
    end if;
    if v_unreturned>0 then
      insert into public.inventory_logs(type,staff,barcode,product_name,quantity,memo,event_id,affects_smaregi,smaregi_delta,store_code,inventory_scope,before_stock,after_stock,event_shelf_before,event_shelf_after)
      values('event_close_return',p_staff,item_row.barcode,coalesce(item_row.product_name,''),-v_unreturned,'イベント差異 / 未帰還 '||v_unreturned||' / 原因未確認',p_event_id,false,0,v_store,'event_shelf',v_before_base,v_before_base,v_after_event,v_after_event);
      v_unreturned_qty:=v_unreturned_qty+v_unreturned;
    end if;
    if v_shortage>0 then
      insert into public.inventory_logs(type,staff,barcode,product_name,quantity,memo,event_id,affects_smaregi,smaregi_delta,store_code,inventory_scope,before_stock,after_stock,event_shelf_before,event_shelf_after)
      values('在庫修正',p_staff,item_row.barcode,coalesce(item_row.product_name,''),0,'イベント棚データ不足 / 不足数量 '||v_shortage||' / 戻り実数を正として通常棚へ反映',p_event_id,false,0,v_store,'event_shelf',v_before_base,v_before_base,v_before_event,v_after_event);
    end if;
    update public.booth_event_items set event_storage_qty=v_after_event,shelf_return_qty=v_returned,shelf_return_reflected=(v_returned>0),shelf_return_reflected_qty=v_returned,shelf_return_reflected_at=case when v_returned>0 then v_now else null end,shelf_return_reflected_by=case when v_returned>0 then p_staff else null end,return_process_type='shelf',return_reflected=(v_returned>0),return_reflected_qty=v_returned,return_reflected_at=case when v_returned>0 then v_now else null end,return_reflected_by=case when v_returned>0 then p_staff else null end,diff_memo=case when v_unreturned>0 or v_shortage>0 then concat_ws(' / ',case when v_unreturned>0 then 'イベント差異 / 未帰還 '||v_unreturned end,case when v_shortage>0 then 'イベント棚データ不足 / 不足数量 '||v_shortage end) else diff_memo end,updated_at=v_now where id=item_row.id;
    v_items:=v_items+1;
  end loop;
  update public.booth_events set status='closed',closed_at=v_now,closed_by=p_staff where id=p_event_id;
  return jsonb_build_object('event_id',p_event_id,'items',v_items,'returned_qty',v_return_qty,'unreturned_qty',v_unreturned_qty,'event_storage_out_qty',v_out_qty);
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_booth_takeout(p_event_id uuid, p_staff text, p_memo text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  item jsonb;
  product_row public.products%rowtype;
  event_row public.booth_events%rowtype;
  event_item_row public.booth_event_items%rowtype;
  storage_row public.event_storage_stocks%rowtype;
  v_barcode text;
  v_qty integer;
  v_before integer;
  v_after integer;
  v_store text;
  v_count integer:=0;
  v_total integer:=0;
  v_now timestamptz:=now();
  v_duplicate integer;
begin
  if p_event_id is null then raise exception 'event_id is required'; end if;
  if coalesce(trim(p_staff),'')='' then raise exception 'staff is required'; end if;
  select * into event_row from public.booth_events where id=p_event_id for share;
  if not found then raise exception 'event not found'; end if;
  if lower(coalesce(event_row.status,'')) in ('closed','cancelled','canceled','invalid','deleted') then raise exception 'event is closed'; end if;
  v_store:=lower(trim(coalesce(event_row.store_code,'')));
  if v_store='' then raise exception 'event store_code is missing'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then raise exception 'items must be an array'; end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    v_barcode:=trim(coalesce(item->>'barcode',''));
    v_qty:=nullif(trim(coalesce(item->>'quantity','')), '')::integer;
    if v_barcode='' then raise exception 'barcode is required'; end if;
    if v_qty is null or v_qty<=0 then raise exception 'quantity must be a positive integer for %',v_barcode; end if;
    select * into product_row from public.products where barcode=v_barcode for update;
    if not found then raise exception 'product not found: %',v_barcode; end if;
    v_before:=coalesce(product_row.base_stock,0);
    if v_before<v_qty then raise exception 'normal stock shortage: % (current % / takeout %)',v_barcode,v_before,v_qty; end if;
    select count(*) into v_duplicate from public.booth_stock_movements where event_id=p_event_id and barcode=v_barcode and item_type='normal' and movement_type in ('take_out','departure_count','event_transfer') and coalesce(cancelled,false)=false;
    if v_duplicate>0 then raise exception 'already confirmed: %',v_barcode; end if;
    v_after:=v_before-v_qty;

    update public.products set base_stock=v_after where barcode=v_barcode;

    select * into storage_row from public.event_storage_stocks where store_code=v_store and barcode=v_barcode for update;
    if found then
      update public.event_storage_stocks set storage_qty=coalesce(storage_row.storage_qty,0)+v_qty,smaregi_product_id=coalesce(product_row.smaregi_product_id,storage_row.smaregi_product_id),product_name=coalesce(product_row.name,storage_row.product_name),updated_at=v_now where id=storage_row.id;
    else
      insert into public.event_storage_stocks(store_code,smaregi_product_id,barcode,product_name,storage_qty,updated_at) values(v_store,product_row.smaregi_product_id,v_barcode,coalesce(product_row.name,''),v_qty,v_now);
    end if;

    insert into public.booth_stock_movements(event_id,barcode,product_name,item_type,movement_type,quantity,staff,memo,takeout_source,affects_smaregi,smaregi_delta) values(p_event_id,v_barcode,coalesce(product_row.name,''),'normal','take_out',v_qty,p_staff,p_memo,'normal',false,0);
    insert into public.event_storage_movements(event_id,store_code,smaregi_product_id,barcode,product_name,movement_type,quantity,staff,memo,before_qty,after_qty) values(p_event_id,v_store,product_row.smaregi_product_id,v_barcode,coalesce(product_row.name,''),'storage_in',v_qty,p_staff,p_memo,coalesce(storage_row.storage_qty,0),coalesce(storage_row.storage_qty,0)+v_qty);

    select * into event_item_row from public.booth_event_items where event_id=p_event_id and barcode=v_barcode and item_type='normal' for update;
    if found then
      update public.booth_event_items set product_name=coalesce(product_row.name,event_item_row.product_name),taken_qty=coalesce(event_item_row.taken_qty,0)+v_qty,normal_takeout_qty=coalesce(event_item_row.normal_takeout_qty,0)+v_qty,difference_qty=coalesce(event_item_row.difference_qty,0)+v_qty,updated_at=v_now where id=event_item_row.id;
    else
      insert into public.booth_event_items(event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,kept_qty,cancelled_takeout_qty,cancelled_return_qty,difference_qty,consumed_qty,normal_takeout_qty,storage_takeout_qty,event_storage_qty,updated_at) values(p_event_id,v_barcode,coalesce(product_row.name,''),'normal',v_qty,0,0,0,0,0,v_qty,0,v_qty,0,0,v_now);
    end if;
    v_count:=v_count+1;
    v_total:=v_total+v_qty;
  end loop;
  return jsonb_build_object('event_id',p_event_id,'items',v_count,'quantity',v_total);
end;
$function$;
