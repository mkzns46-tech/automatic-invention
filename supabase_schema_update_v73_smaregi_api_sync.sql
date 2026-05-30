-- v73追加SQL：スマレジAPI同期
-- 旧v72 SQLを実行済みの場合、Supabase SQL Editorで1回実行してください。

alter table public.smaregi_stock_snapshots add column if not exists source text not null default 'csv';
alter table public.smaregi_stock_snapshots add column if not exists range_from timestamptz;
alter table public.smaregi_stock_snapshots add column if not exists range_to timestamptz;
alter table public.smaregi_stock_snapshots add column if not exists completed_at timestamptz;
alter table public.smaregi_stock_items add column if not exists product_id text;
alter table public.smaregi_stock_items add column if not exists store_id text;
alter table public.smaregi_stock_items add column if not exists latest_change_at timestamptz;
alter table public.smaregi_stock_items add column if not exists change_count integer not null default 0;

create table if not exists public.smaregi_stock_changes (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.smaregi_stock_snapshots(id) on delete cascade,
  smaregi_change_id text not null,
  product_id text,
  store_id text,
  barcode text,
  changed_at timestamptz,
  amount integer not null default 0,
  stock_amount integer not null default 0,
  stock_division text,
  memo text,
  created_at timestamptz not null default now(),
  unique(snapshot_id, smaregi_change_id)
);

create index if not exists smaregi_stock_changes_snapshot_id_idx
  on public.smaregi_stock_changes(snapshot_id);

alter table public.smaregi_stock_changes enable row level security;
drop policy if exists "smaregi changes all" on public.smaregi_stock_changes;
create policy "smaregi changes all" on public.smaregi_stock_changes for all using (true) with check (true);
