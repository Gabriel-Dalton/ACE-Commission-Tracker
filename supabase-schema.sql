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

-- Payment-tracking columns (added with the "paid as the client pays" rewrite).
-- These store per-deal collection state so the tracker syncs across devices.
alter table deals add column if not exists payments_collected  int     default 0;
alter table deals add column if not exists cancelled           boolean default false;
alter table deals add column if not exists cancelled_date      date;
alter table deals add column if not exists first_payment_date  date;

-- Legacy: a previous version linked extra subscriptions to a "primary" deal
-- via parent_id. Subscriptions are now equal peers grouped by client name,
-- so the column is unused going forward. Kept here (nullable) for old rows.
alter table deals add column if not exists parent_id text;
create index if not exists deals_parent_id_idx on deals(parent_id);

-- Money received: count of commission payouts Gabriel has personally collected
-- from his employer. Mirrors payments_collected (which tracks what the client
-- paid ACE). A simple counter lets monthly deals be checked off as each
-- monthly commission lands; one-shot deals just toggle 0 ↔ 1.
alter table deals add column if not exists payments_paid_out int default 0;
alter table deals add column if not exists last_paid_out_date date;

create table if not exists settings (
  key         text primary key,
  value       jsonb,
  updated_at  timestamptz default now()
);

-- Monthly verification queue: each row is one (deal, billing month) pending
-- a "is this client still with us?" check. Populated by the
-- queue-verifications GitHub Action; consumed and deleted by the dashboard
-- when Gabriel confirms or cancels. Unique on (deal_id, period_month) so
-- the action is idempotent and re-runs never double-queue.
create table if not exists pending_verifications (
  id            bigserial primary key,
  deal_id       text not null,
  period_month  text not null,
  queued_at     timestamptz default now(),
  unique (deal_id, period_month)
);
create index if not exists pending_verifications_deal_idx on pending_verifications(deal_id);

-- Immutable audit log of every verification decision. Persists past deletion
-- of the deal (deal_name is denormalized) so the "transparent proof that I
-- said that" trail survives indefinitely.
create table if not exists verification_log (
  id            bigserial primary key,
  deal_id       text not null,
  deal_name     text not null,
  decision      text not null check (decision in ('confirmed_active', 'marked_cancelled', 'skipped')),
  period_month  text not null,
  verified_at   timestamptz default now(),
  notes         text
);
create index if not exists verification_log_deal_idx     on verification_log(deal_id);
create index if not exists verification_log_verified_idx on verification_log(verified_at desc);

-- Stamp on the deal so the dashboard can show "last reviewed" at a glance.
alter table deals add column if not exists last_verified_at timestamptz;

-- Row Level Security: enabled but permissive for the publishable key.
-- This is appropriate for a single-user personal tracker.
-- If you ever expose this app publicly, swap these for auth.uid()-scoped policies.
alter table deals                  enable row level security;
alter table settings               enable row level security;
alter table pending_verifications  enable row level security;
alter table verification_log       enable row level security;

drop policy if exists "deals all anon"                  on deals;
drop policy if exists "settings all anon"               on settings;
drop policy if exists "pending_verifications all anon"  on pending_verifications;
drop policy if exists "verification_log all anon"       on verification_log;

create policy "deals all anon"                  on deals                  for all to anon using (true) with check (true);
create policy "settings all anon"               on settings               for all to anon using (true) with check (true);
create policy "pending_verifications all anon"  on pending_verifications  for all to anon using (true) with check (true);
create policy "verification_log all anon"       on verification_log       for all to anon using (true) with check (true);
