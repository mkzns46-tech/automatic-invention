-- ARICO sales management Supabase schema.
-- Run this in Supabase SQL editor before switching sales data from localStorage to Supabase.
-- Existing localStorage data is not deleted by this SQL.

create extension if not exists pgcrypto;

create table if not exists public.sales_customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text unique,
  data jsonb not null default '{}'::jsonb,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text
);

create table if not exists public.sales_quotes (
  id uuid primary key default gen_random_uuid(),
  document_no text unique,
  data jsonb not null default '{}'::jsonb,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text
);

create table if not exists public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  document_no text unique,
  quote_document_no text,
  data jsonb not null default '{}'::jsonb,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text
);

create table if not exists public.sales_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_document_no text,
  data jsonb not null default '{}'::jsonb,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text
);

create table if not exists public.sales_deliveries (
  id uuid primary key default gen_random_uuid(),
  document_no text unique,
  invoice_document_no text,
  data jsonb not null default '{}'::jsonb,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text
);

create table if not exists public.sales_receipts (
  id uuid primary key default gen_random_uuid(),
  document_no text unique,
  invoice_document_no text,
  data jsonb not null default '{}'::jsonb,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text
);

create table if not exists public.sales_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

create or replace function public.set_sales_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_sales_customers_updated_at on public.sales_customers;
create trigger set_sales_customers_updated_at
before update on public.sales_customers
for each row execute function public.set_sales_updated_at();

drop trigger if exists set_sales_quotes_updated_at on public.sales_quotes;
create trigger set_sales_quotes_updated_at
before update on public.sales_quotes
for each row execute function public.set_sales_updated_at();

drop trigger if exists set_sales_invoices_updated_at on public.sales_invoices;
create trigger set_sales_invoices_updated_at
before update on public.sales_invoices
for each row execute function public.set_sales_updated_at();

drop trigger if exists set_sales_payments_updated_at on public.sales_payments;
create trigger set_sales_payments_updated_at
before update on public.sales_payments
for each row execute function public.set_sales_updated_at();

drop trigger if exists set_sales_deliveries_updated_at on public.sales_deliveries;
create trigger set_sales_deliveries_updated_at
before update on public.sales_deliveries
for each row execute function public.set_sales_updated_at();

drop trigger if exists set_sales_receipts_updated_at on public.sales_receipts;
create trigger set_sales_receipts_updated_at
before update on public.sales_receipts
for each row execute function public.set_sales_updated_at();

drop trigger if exists set_sales_settings_updated_at on public.sales_settings;
create trigger set_sales_settings_updated_at
before update on public.sales_settings
for each row execute function public.set_sales_updated_at();
