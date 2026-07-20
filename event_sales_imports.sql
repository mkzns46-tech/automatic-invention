create table if not exists public.event_sales_imports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.booth_events(id) on delete cascade,
  smaregi_transaction_id text not null,
  smaregi_detail_id text not null,
  smaregi_product_id text not null,
  barcode text not null,
  product_name text not null,
  quantity integer not null check (quantity <> 0),
  sold_at timestamptz,
  store_code text not null,
  smaregi_store_id text,
  target_register_code text,
  target_register_name text,
  smaregi_register_id text,
  smaregi_terminal_id text,
  import_status text not null default 'pending'
    check (import_status in ('pending','confirmed','cancelled')),
  imported_by text,
  imported_at timestamptz,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, smaregi_transaction_id, smaregi_detail_id)
);

alter table public.event_sales_imports
  add column if not exists target_register_code text,
  add column if not exists target_register_name text,
  add column if not exists smaregi_register_id text,
  add column if not exists smaregi_terminal_id text,
  add column if not exists unit_price integer not null default 0,
  add column if not exists amount integer not null default 0;

create index if not exists event_sales_imports_event_status_idx
  on public.event_sales_imports(event_id, import_status);

create index if not exists event_sales_imports_event_barcode_idx
  on public.event_sales_imports(event_id, barcode);

create index if not exists event_sales_imports_store_sold_at_idx
  on public.event_sales_imports(store_code, sold_at);

create index if not exists event_sales_imports_terminal_idx
  on public.event_sales_imports(store_code, smaregi_terminal_id, sold_at);

create index if not exists event_sales_imports_register_idx
  on public.event_sales_imports(store_code, smaregi_register_id, sold_at);

grant select, insert, update on public.event_sales_imports to anon, authenticated;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'event_sales_imports_quantity_check'
      and conrelid = 'public.event_sales_imports'::regclass
  ) then
    alter table public.event_sales_imports
      drop constraint event_sales_imports_quantity_check;
  end if;
end $$;

alter table public.event_sales_imports
  add constraint event_sales_imports_quantity_check
  check (quantity <> 0);
