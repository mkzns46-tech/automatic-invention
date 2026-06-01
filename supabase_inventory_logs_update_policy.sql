grant update on table public.inventory_logs to anon, authenticated;

drop policy if exists "inventory_logs_update_for_inventory_app" on public.inventory_logs;

create policy "inventory_logs_update_for_inventory_app"
on public.inventory_logs
for update
to anon, authenticated
using (true)
with check (true);
