-- ═══════════════════════════════════════════════════════════════════
-- Audit item 7 — cross-device sync guard (OPTIONAL hardening)
-- ═══════════════════════════════════════════════════════════════════
-- The client-side fix (push only changed rows) already stops the reported
-- data-loss bug: a device that adds/edits one flight no longer re-pushes its
-- stale copies of flights another device corrected. You do NOT need this SQL
-- for that fix to work.
--
-- This adds server-side defense-in-depth for the narrow case where an OLD
-- write arrives after a NEWER one (e.g. a queued offline op drains late): the
-- flights trigger rejects a stale update instead of clobbering the newer row.
-- Last-write-by-client-clock wins, deterministically.
--
-- Safe to run once, in the Supabase SQL editor. It only repoints the flights
-- trigger; profiles / opening_balances keep public.set_updated_at() untouched
-- (they have no client_updated_at column, which is why this is flights-only).
-- Reversible: see the bottom of this file.
-- ───────────────────────────────────────────────────────────────────

create or replace function public.flights_guard_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- Reject a stale content update: incoming client clock is not newer than the
  -- stored one AND this isn't a soft-delete (deleted_at unchanged). Keep OLD.
  if (tg_op = 'UPDATE'
      and new.client_updated_at is not null
      and old.client_updated_at is not null
      and new.client_updated_at <= old.client_updated_at
      and new.deleted_at is not distinct from old.deleted_at) then
    return old;            -- no-op: the newer stored version survives
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists flights_updated_at on public.flights;
create trigger flights_updated_at
  before update on public.flights
  for each row execute function public.flights_guard_updated_at();

-- ── To revert to the shared unconditional trigger ──────────────────
-- drop trigger if exists flights_updated_at on public.flights;
-- create trigger flights_updated_at
--   before update on public.flights
--   for each row execute function public.set_updated_at();
-- drop function if exists public.flights_guard_updated_at();
