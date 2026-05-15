-- v6追加SQL：全データ上書き用DELETE権限
-- Supabase SQL Editorで1回実行してください

drop policy if exists "products delete all" on public.products;
drop policy if exists "logs delete all" on public.inventory_logs;
drop policy if exists "checks delete all" on public.inventory_checks;

create policy "products delete all" on public.products for delete using (true);
create policy "logs delete all" on public.inventory_logs for delete using (true);
create policy "checks delete all" on public.inventory_checks for delete using (true);
