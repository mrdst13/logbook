-- ═══════════════════════════════════════════════════════════════════
-- Corrections du carnet — audit des rosters officiels déc → mai (2026-07-10)
-- ═══════════════════════════════════════════════════════════════════
-- À exécuter UNE FOIS : Supabase → SQL Editor → New query → coller → Run.
-- Atomique (begin/commit) : si une seule ligne échoue, RIEN ne s'applique.
-- Se synchronise sur tes 2 appareils au prochain rafraîchissement (pull).
-- Dates confirmées par Martin (le pilote) : le 29 mai il a volé PD154 puis
-- PD235 (déroutement vers YOW) ; le 30 mai il était en congé.
-- ═══════════════════════════════════════════════════════════════════
begin;

-- 1) AJOUTER le vol manquant PD428 (6 janvier, YWG→YYZ, 2,67 h = 2h40 BLH),
--    cloné de sa patte voisine PD291 (mêmes capitaine/appareil/profil).
insert into public.flights (
  user_id, date, flight_num, type, reg, dep_icao, arr_icao, route,
  pic, copilot, block, total, me_day_cop,
  is_sim, ac_config, multi_crew, signed_by, signed_at,
  client_updated_at, updated_at)
select
  user_id, date, 'PD428', type, reg, 'YWG', 'YYZ', 'YWG-YYZ',
  pic, copilot, 2.67, 2.67, 2.67,
  is_sim, ac_config, multi_crew, signed_by, signed_at,
  now(), now()
from public.flights
where id = '8f23d723-1deb-4c8e-a58e-0586aa78ff64'
  and not exists (
    select 1 from public.flights
    where flight_num = 'PD428' and date = '2026-01-06' and deleted_at is null);

-- 2) RE-DATER PD767 (aller YOW-CUN) du 13 au 12 avril (le 13 = journée au sol).
update public.flights set date = '2026-04-12', updated_at = now()
where id = 'fffb5c47-7e78-4732-b093-252e5ad96f8b';

-- 3) RE-DATER PD768 (retour CUN-YOW) du 13 au 12 avril.
update public.flights set date = '2026-04-12', updated_at = now()
where id = '6ac59c81-b068-440f-85b7-f814150960c0';

-- 4) PD235 — LE VRAI vol du 29 MAI : on garde l'entrée propre (capitaine
--    Bromley, copilote self, bloc 3,6), on la re-date au 29 mai, et on inscrit
--    ton déroutement (arrivée YOW au lieu de YYT).
update public.flights set
  date = '2026-05-29',
  arr_icao = 'YOW', route = 'YYZ-YOW',
  remarks = 'Scheduled YYZ-YYT; diverted to YOW', updated_at = now()
where id = '797cac02-8d3e-4af0-b060-a87384035c36';

-- 5) SUPPRIMER (soft-delete) la copie corrompue du PD235 (mauvais capitaine
--    Duchesne). deleted_at → se propage proprement, pas de résurrection iCal.
update public.flights set deleted_at = now(), updated_at = now()
where id = '1a787399-96a3-40b1-81ba-3b2c8f64cb64';

commit;

-- Vérification (le résultat s'affiche sous la requête) :
select date, flight_num, route, block,
       case when deleted_at is null then 'actif' else 'SUPPRIMÉ' end as etat
from public.flights
where (flight_num = 'PD428'  and date = '2026-01-06')
   or (flight_num in ('PD767','PD768') and date in ('2026-04-12','2026-04-13'))
   or (flight_num = 'PD235'  and date in ('2026-05-29','2026-05-30'))
order by date, flight_num;
