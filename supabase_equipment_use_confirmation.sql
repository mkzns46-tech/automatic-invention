alter table public.inventory_logs
  add column if not exists equipment_checked boolean default false,
  add column if not exists equipment_checked_by text,
  add column if not exists equipment_checked_at timestamptz;

alter table public.inventory_logs
  drop constraint if exists inventory_logs_type_check;

alter table public.inventory_logs
  add constraint inventory_logs_type_check
  check (type in ('入荷','出荷','在庫修正','備品転用'));

alter table public.products
  add column if not exists category text,
  add column if not exists genre text,
  add column if not exists department text;

alter table public.smaregi_stock_checks
  add column if not exists no_issue boolean default false,
  add column if not exists no_issue_by text,
  add column if not exists no_issue_at timestamptz,
  add column if not exists no_issue_reason text,
  add column if not exists actual_corrected boolean default false,
  add column if not exists actual_corrected_by text,
  add column if not exists actual_corrected_at timestamptz;
