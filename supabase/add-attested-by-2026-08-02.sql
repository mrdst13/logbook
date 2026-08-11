-- Carry the attestation SIGNER through the cloud, end to end.
-- 2026-08-02 final audit: the SHA-256 seal on the brought-forward attestation
-- binds the hour values, the cutoff date AND the signer. The cloud row had no
-- attested_by column, so a record adopted on a second device lost its signer
-- and could never re-verify its own seal - the false tamper alarm the
-- 2026-08-01 newest-attestation rule was rolled back over. With this column
-- the rule can hold end to end.
--
-- Until this runs, the app detects the missing column (42703), pushes the rest
-- of the attestation without it, and the launch-time seal check names the
-- missing signer instead of claiming tampering.
--
-- Run once in the Supabase SQL editor. Idempotent (IF NOT EXISTS).

alter table public.opening_balances
  add column if not exists attested_by text;
