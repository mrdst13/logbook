-- ═══════════════════════════════════════════════════════════════════
-- CORRECTIF SYNCHRO — heures reportées + validités  (2026-07-09)
-- ═══════════════════════════════════════════════════════════════════
-- Cause racine : la table `opening_balances` (heures reportées du carnet
-- papier) n'a JAMAIS été créée. Le code essayait d'y écrire → chaque envoi
-- échouait en silence → le nuage restait vide → un 2e appareil ne descendait
-- rien. Ce script la crée (mêmes règles de sécurité que les autres tables) et
-- ajoute au passage les deux colonnes pour la synchro des validités.
--
-- À exécuter UNE FOIS : Supabase → SQL Editor → New query → coller → Run.
-- Sans danger, idempotent : « if not exists » partout, ne touche à aucune
-- donnée existante.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Table des heures reportées (1:1 avec l'utilisateur) ──────────
create table if not exists public.opening_balances (
  user_id     uuid primary key references auth.users on delete cascade,
  balances    jsonb not null default '{}'::jsonb,
  attested_at timestamptz,
  cutoff_date text,
  hash        text,
  updated_at  timestamptz default now()
);

-- Défensif : si une table partielle existait déjà, garantir chaque colonne.
alter table public.opening_balances add column if not exists balances    jsonb not null default '{}'::jsonb;
alter table public.opening_balances add column if not exists attested_at timestamptz;
alter table public.opening_balances add column if not exists cutoff_date text;
alter table public.opening_balances add column if not exists hash        text;
alter table public.opening_balances add column if not exists updated_at  timestamptz default now();

alter table public.opening_balances enable row level security;

drop policy if exists "opening_balances_select_own" on public.opening_balances;
create policy "opening_balances_select_own" on public.opening_balances
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "opening_balances_insert_own" on public.opening_balances;
create policy "opening_balances_insert_own" on public.opening_balances
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "opening_balances_update_own" on public.opening_balances;
create policy "opening_balances_update_own" on public.opening_balances
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Sans ce GRANT, PostgREST répond « permission denied » (cf. note en tête de
-- schema.sql). Jamais à anon — donnée privée.
grant select, insert, update on public.opening_balances to authenticated;

drop trigger if exists opening_balances_updated_at on public.opening_balances;
create trigger opening_balances_updated_at
  before update on public.opening_balances
  for each row execute function public.set_updated_at();

-- ── 2. Colonnes pour la synchro des validités personnalisées ────────
alter table public.profiles add column if not exists custom_validities jsonb;
alter table public.profiles add column if not exists personal_goal_bf  numeric;
