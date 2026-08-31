-- Applied to Production before the v2.92.00 client changes.
-- Nullable fixed-stock snapshots preserve compatibility with existing rows.
alter table public.inventory_logs
  add column if not exists store_code text,
  add column if not exists inventory_scope text,
  add column if not exists before_stock integer,
  add column if not exists after_stock integer,
  add column if not exists event_shelf_before integer,
  add column if not exists event_shelf_after integer;

alter table public.event_storage_movements
  add column if not exists before_qty integer,
  add column if not exists after_qty integer;
