-- ═══════════════════════════════════════════════════════════════════
-- Sync des validités personnalisées + objectif par type (2026-07-08)
-- ═══════════════════════════════════════════════════════════════════
-- À exécuter UNE FOIS dans Supabase → SQL Editor. Après ça, tes validités
-- (Passeport, RAIC, Line check…) et tes heures reportées sur type (782,7 h
-- E195) se synchronisent entre ton ordi et ton iPhone.
-- Sans danger : n'ajoute que deux colonnes optionnelles, ne touche à rien.
-- Le code fonctionne déjà avec ou sans ces colonnes (il retombe sans elles) —
-- mais tant qu'elles ne sont pas là, ces deux champs ne se synchronisent pas.

alter table public.profiles
  add column if not exists custom_validities jsonb,
  add column if not exists personal_goal_bf  numeric;
