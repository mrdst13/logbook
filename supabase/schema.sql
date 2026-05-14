-- ═══════════════════════════════════════════════════════════════════
-- Cumulo Flight Deck — Supabase schema (Phase 1 + Phase 2)
-- ═══════════════════════════════════════════════════════════════════
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Region: ca-central-1 (Montréal).
--
-- IMPORTANT (post May 30 2026 change): we MUST add GRANT after each
-- CREATE TABLE for the table to be exposed to the Data API. Without
-- the GRANT, PostgREST returns "permission denied for table X" with
-- no obvious cause. The pattern is repeated for every user-data table.
--
-- All policies are owner-scoped via auth.uid() — we never grant to anon.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- Helper: updated_at trigger function (used by all tables with LWW sync)
-- ───────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ───────────────────────────────────────────────────────────────────
-- profiles  (1:1 with auth.users)
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  fname text,
  lname text,
  rank text,
  airline text,
  license text,
  medical date,
  base text,
  fleet text,
  operator_codes text,
  navblue_url text,
  pilot_type text default 'airline705' check (pilot_type in ('airline705','airline704','airline703','private','student','instructor')),

  -- Display & PIPEDA preferences
  auto_count_ifr boolean default true,
  consent_captain_names boolean default false,  -- PIPEDA: OFF → anonymize at write time
  hide_zero_columns boolean default false,
  lang text default 'en' check (lang in ('en','fr')),
  dark_mode boolean default false,

  -- Free-form prefs (column visibility manifest, etc.)
  ac_configs jsonb default '["wheels"]'::jsonb,
  column_prefs jsonb default '{}'::jsonb,

  -- Sync
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No delete policy: row deletes only via auth.users cascade.

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
-- Never grant to anon — profile data is private.

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────
-- flights  (TC 38-column schema + extensions)
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.flights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,

  -- Core identification
  date date not null,
  flight_num text,
  type text,
  reg text,
  dep_icao text,
  arr_icao text,
  via text,
  route text,

  -- Crew (captain name may be anonymized — see consent_captain_names)
  pic text,
  copilot text,

  -- Timing
  dtstart_utc timestamptz,
  std_utc text,    -- HHMM 4-char string
  sta_utc text,
  co_utc text,     -- chock-off (block-off) actual
  ci_utc text,     -- chock-in (block-on) actual

  -- Hours (numeric(5,2) to match the 38-col TC schema in 08-flight-form.js)
  block numeric(5,2) default 0,
  duty numeric(5,2) default 0,
  total numeric(5,2) default 0,

  me_day_pic numeric(5,2) default 0,
  me_night_pic numeric(5,2) default 0,
  me_day_cop numeric(5,2) default 0,
  me_night_cop numeric(5,2) default 0,
  me_day_dual numeric(5,2) default 0,
  me_night_dual numeric(5,2) default 0,

  se_day numeric(5,2) default 0,
  se_night numeric(5,2) default 0,

  -- Helicopter (own engine class; rotorcraft hours never contaminate SE/ME totals)
  heli_day_pic numeric(5,2) default 0,
  heli_night_pic numeric(5,2) default 0,
  heli_day_cop numeric(5,2) default 0,
  heli_night_cop numeric(5,2) default 0,
  heli_day_dual numeric(5,2) default 0,
  heli_night_dual numeric(5,2) default 0,
  hover_time numeric(5,2) default 0,

  xc_day_pic numeric(5,2) default 0,
  xc_night_pic numeric(5,2) default 0,
  xc_day_cop numeric(5,2) default 0,
  xc_night_cop numeric(5,2) default 0,
  xc_day_dual numeric(5,2) default 0,
  xc_night_dual numeric(5,2) default 0,

  inst_actual numeric(5,2) default 0,
  inst_hood numeric(5,2) default 0,
  inst_sim numeric(5,2) default 0,

  approaches int default 0,
  picus numeric(5,2) default 0,

  to_day int default 0,
  to_night int default 0,
  ldg_day int default 0,
  ldg_night int default 0,

  -- Dual given (CFI ATPL credit)
  dual_given_day numeric(5,2) default 0,
  dual_given_night numeric(5,2) default 0,

  -- Simulator (TC 38-col extension)
  is_sim boolean default false,
  sim_type text,         -- FFS Level D-C / FTD / FNPT / BITD
  sim_session text,      -- PPC / IPC / IFR Renewal / Recurrent / Initial / Type Rating / LOFT
  sim_registration text,

  -- Aircraft configuration
  ac_config text,        -- wheels/floats/skis/amphibian/tailwheel/helicopter/glider
  multi_crew boolean default false,

  -- Notes / provenance
  remarks text,
  source text,                       -- 'manual' / 'navblue' / 'pdf-roster' / 'csv-foreflight' / ...
  sources jsonb default '[]'::jsonb, -- audit trail of merges
  navblue_uid text,                  -- iCal UID for dedup

  -- Attestation (per-import batch signature)
  signed_by text,
  signed_at timestamptz,

  -- Sync (LWW via updated_at; client_updated_at sent by offline queue)
  client_updated_at timestamptz not null default now(),
  device_id text,
  op_id uuid,
  updated_at timestamptz default now()
);

alter table public.flights enable row level security;

create policy "flights_select_own" on public.flights
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "flights_insert_own" on public.flights
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "flights_update_own" on public.flights
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "flights_delete_own" on public.flights
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.flights to authenticated;
-- Never grant to anon — flight data is private.

drop trigger if exists flights_updated_at on public.flights;
create trigger flights_updated_at
  before update on public.flights
  for each row execute function public.set_updated_at();

-- Indexes (only the ones we actually use today — no premature optimization)
create index if not exists flights_user_date_idx
  on public.flights (user_id, date desc);

create index if not exists flights_user_updated_idx
  on public.flights (user_id, updated_at desc);

-- Dedup for Navblue iCal imports (one row per (user, navblue UID))
create unique index if not exists flights_user_navblue_uid_idx
  on public.flights (user_id, navblue_uid)
  where navblue_uid is not null;

-- ───────────────────────────────────────────────────────────────────
-- trusted_devices  (Phase 1 — skeleton; full flow not wired yet)
-- ───────────────────────────────────────────────────────────────────
-- Pattern (per security panel): on MFA success + "Trust 60 days" checked,
-- generate a random 32-byte token. Store SHA-256 hash here, raw token in
-- client localStorage. On next login, before requiring TOTP, check
-- hash(token) ∈ trusted_devices for this user_id where expires_at > now().
--
-- TODO: wire challenge/verify flow in src/js/18-supabase.js after first
-- end-to-end auth test. Keeping the table here so the schema is complete.
create table if not exists public.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  device_hash text not null,           -- SHA-256 of client token
  user_agent text,
  ip inet,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

alter table public.trusted_devices enable row level security;

create policy "trusted_devices_select_own" on public.trusted_devices
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "trusted_devices_insert_own" on public.trusted_devices
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "trusted_devices_delete_own" on public.trusted_devices
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, delete on public.trusted_devices to authenticated;

create index if not exists trusted_devices_user_hash_idx
  on public.trusted_devices (user_id, device_hash);

-- ───────────────────────────────────────────────────────────────────
-- Auto-create profile row on signup (trigger)
-- ───────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════════
-- Verification queries (run after the schema to confirm everything is wired)
-- ═══════════════════════════════════════════════════════════════════
-- 1. Confirm RLS is ON for all user tables (should return 3 rows, all true):
--    select relname, relrowsecurity from pg_class
--    where relname in ('profiles','flights','trusted_devices');
--
-- 2. Confirm policies (should return ~10 policies):
--    select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public' order by tablename, cmd;
--
-- 3. Smoke test: with anon key, "select * from flights" should return
--    "permission denied" (correct — anon has no access).
