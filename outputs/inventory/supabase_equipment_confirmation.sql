alter table public.inventory_logs
  add column if not exists equipment_checked boolean default false,
  add column if not exists equipment_checked_by text,
  add column if not exists equipment_checked_at timestamptz;
