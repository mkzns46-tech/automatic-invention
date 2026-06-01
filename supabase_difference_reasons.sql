alter table public.smaregi_stock_checks
  add column if not exists difference_reason_category text,
  add column if not exists difference_reason_memo text,
  add column if not exists difference_reason_by text,
  add column if not exists difference_reason_at timestamptz;
