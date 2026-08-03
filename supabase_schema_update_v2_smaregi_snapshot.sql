-- Smaregi difference check snapshot v2.
-- Run this in the Supabase SQL Editor after reviewing the target project.
-- Existing rows remain NULL and are intentionally not backfilled.

alter table public.smaregi_stock_checks
  add column if not exists store_id text,
  add column if not exists product_id text,
  add column if not exists product_name text,
  add column if not exists app_stock_at_check integer,
  add column if not exists event_shelf_stock_at_check integer,
  add column if not exists comparison_stock_at_check integer,
  add column if not exists smaregi_stock_at_check integer,
  add column if not exists difference_at_check integer,
  add column if not exists is_auto_no_issue_at_check boolean,
  add column if not exists is_manual_no_issue boolean,
  add column if not exists snapshot_version integer;

comment on column public.smaregi_stock_checks.snapshot_version is
  '2 = check-time app/event/Smaregi inventory snapshot';

grant select, insert, update on public.smaregi_stock_checks to anon, authenticated;
