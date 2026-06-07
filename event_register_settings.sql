create table if not exists public.event_register_settings (
  store_code text primary key,
  register_id text,
  register_name text not null,
  terminal_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.event_register_settings (store_code, register_name)
values
  ('tokyo', '東京イベントレジ'),
  ('aichi', '愛知イベントレジ')
on conflict (store_code) do nothing;

grant select, insert, update on public.event_register_settings to anon, authenticated;
