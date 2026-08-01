-- Per-row acceptance stamp: when the pilot accepted a change to this flight,
-- and their initials.
-- 2026-08-01. Martin: "tout ce que je veux c'est un timestamp et mes initiales
-- apres que j'ai accepte un changement dans le logbook."
--
-- Written by saveFlight (form), confirmImport (every import path) and
-- applyNightRecheck. Deliberately NOT the existing signed_by / signed_at pair:
-- those mean a formal per-batch attestation, and the day/night recheck tool
-- refuses to touch any row carrying them (30-night-recheck.js). Reusing them
-- for an ordinary accepted edit would have frozen the whole logbook against
-- its own repair tools.
--
-- Until this runs, the app detects the missing columns (42703), drops them from
-- the payload and keeps syncing everything else; the stamp simply stays on the
-- device that wrote it. Running this later needs no code change - the next
-- launch starts sending them.
--
-- Run once in the Supabase SQL editor. Idempotent (IF NOT EXISTS).

alter table public.flights
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by text;
