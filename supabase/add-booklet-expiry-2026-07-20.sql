-- Aviation Document Booklet expiry - cross-device profile field.
-- 2026-07-20. Martin asked to show the booklet expiry on the PDF cover
-- (in place of the ECG row). The profile syncs by explicit column, so the
-- new field needs its own column or it saves locally but never reaches the
-- other device. `date` type (like medical / ecg) round-trips cleanly.
--
-- Run once in the Supabase SQL editor. Idempotent (IF NOT EXISTS).

alter table public.profiles
  add column if not exists booklet_expiry date;
