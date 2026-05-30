-- v72追加SQL：スマレジ変動商品チェック
-- Supabase SQL Editorで1回実行してください。

create table if not exists public.smaregi_stock_snapshots (
  id uuid primary key default gen_random_uuid(),
  imported_at timestamptz not null default now(),
  imported_by text,
  note text
);

create table if not exists public.smaregi_stock_items (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.smaregi_stock_snapshots(id) on delete cascade,
  barcode text not null,
  product_name text,
  smaregi_stock integer not null default 0,
  created_at timestamptz not null default now(),
  unique(snapshot_id, barcode)
);

create table if not exists public.smaregi_stock_checks (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.smaregi_stock_snapshots(id) on delete cascade,
  barcode text not null,
  actual_stock integer not null default 0,
  difference integer not null default 0,
  checked_by text,
  checked_at timestamptz not null default now(),
  unique(snapshot_id, barcode)
);

create index if not exists smaregi_stock_items_snapshot_id_idx
  on public.smaregi_stock_items(snapshot_id);
create index if not exists smaregi_stock_checks_snapshot_id_idx
  on public.smaregi_stock_checks(snapshot_id);

alter table public.smaregi_stock_snapshots enable row level security;
alter table public.smaregi_stock_items enable row level security;
alter table public.smaregi_stock_checks enable row level security;

drop policy if exists "smaregi snapshots all" on public.smaregi_stock_snapshots;
drop policy if exists "smaregi items all" on public.smaregi_stock_items;
drop policy if exists "smaregi checks all" on public.smaregi_stock_checks;

create policy "smaregi snapshots all" on public.smaregi_stock_snapshots for all using (true) with check (true);
create policy "smaregi items all" on public.smaregi_stock_items for all using (true) with check (true);
create policy "smaregi checks all" on public.smaregi_stock_checks for all using (true) with check (true);
