-- ARICO ARCHERY 販売管理 v1.1 見積書 Supabase テーブル案
-- まだ実行しないでください。実行前に既存 RLS / 権限設計を確認してください。

create table if not exists public.sales_number_sequences (
  name text primary key,
  current_value bigint not null default 0,
  prefix text not null,
  padding integer not null default 6,
  updated_at timestamptz not null default now()
);

insert into public.sales_number_sequences (name, current_value, prefix, padding)
values ('quote', 0, 'Q-', 6)
on conflict (name) do nothing;

create table if not exists public.sales_quotes (
  id uuid primary key default gen_random_uuid(),
  quote_no text not null unique,
  status text not null default '下書き',
  customer_name text not null,
  customer_type text not null default '個人',
  customer_address text,
  customer_phone text,
  customer_email text,
  subject text,
  quote_date date not null default current_date,
  valid_until date,
  staff text,
  memo text,
  discount_template text not null default 'none',
  subtotal integer not null default 0,
  discount_total integer not null default 0,
  total integer not null default 0,
  tax_total integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.sales_quotes(id) on delete cascade,
  line_no integer not null,
  barcode text,
  smaregi_product_id text,
  product_name text not null,
  stock_snapshot integer not null default 0,
  qty numeric(12,2) not null default 0,
  unit text not null default '個',
  unit_price integer not null default 0,
  discount_value numeric(5,2) not null default 0,
  discount_amount integer not null default 0,
  amount integer not null default 0,
  memo text,
  created_at timestamptz not null default now()
);

create index if not exists sales_quote_items_quote_id_idx
  on public.sales_quote_items (quote_id, line_no);

create index if not exists sales_quotes_quote_date_idx
  on public.sales_quotes (quote_date desc);

create or replace function public.next_sales_number(sequence_name text)
returns text
language plpgsql
as $$
declare
  seq public.sales_number_sequences%rowtype;
begin
  update public.sales_number_sequences
  set current_value = current_value + 1,
      updated_at = now()
  where name = sequence_name
  returning * into seq;

  if not found then
    raise exception 'sales number sequence not found: %', sequence_name;
  end if;

  return seq.prefix || lpad(seq.current_value::text, seq.padding, '0');
end;
$$;
