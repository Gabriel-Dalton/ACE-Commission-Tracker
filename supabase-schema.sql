-- ACE Commission Tracker — Supabase schema
-- Run in: Supabase Dashboard → SQL Editor → New query

create table if not exists deals (
  id          text primary key,
  name        text not null,
  mrr         numeric not null,
  plan        text not null,
  date        date not null,
  billing     text default 'monthly',
  ref         text,
  created_at  timestamptz default now()
);

create index if not exists deals_date_idx on deals(date);

create table if not exists settings (
  key         text primary key,
  value       jsonb,
  updated_at  timestamptz default now()
);

-- Row Level Security: enabled but permissive for the publishable key.
-- This is appropriate for a single-user personal tracker.
-- If you ever expose this app publicly, swap these for auth.uid()-scoped policies.
alter table deals    enable row level security;
alter table settings enable row level security;

drop policy if exists "deals all anon"    on deals;
drop policy if exists "settings all anon" on settings;

create policy "deals all anon"    on deals    for all to anon using (true) with check (true);
create policy "settings all anon" on settings for all to anon using (true) with check (true);
