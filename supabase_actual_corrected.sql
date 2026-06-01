alter table public.smaregi_stock_checks
  add column if not exists actual_corrected boolean default false,
  add column if not exists actual_corrected_by text,
  add column if not exists actual_corrected_at timestamptz;
