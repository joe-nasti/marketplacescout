-- ACR Beyond and Collector Booster configurations checked against Wizards'
-- official slot/probability guide, then pinned to the hydrated MTGJSON shape.
insert into public.sealed_collation_adapters
  (adapter_key,adapter_family,display_name,model_kind,reusable_across_sets,description,default_assumptions)
values
  ('beyond_booster_mtgjson_v1','beyond_booster','MTGJSON native Beyond Booster','probabilistic_pack',true,
   'Beyond Booster economics from a set-specific, officially verified MTGJSON native configuration',
   '{"requires_official_verification":true,"native_config_code":"default"}')
on conflict(adapter_key) do update set
  adapter_family=excluded.adapter_family,
  display_name=excluded.display_name,
  model_kind=excluded.model_kind,
  reusable_across_sets=excluded.reusable_across_sets,
  description=excluded.description,
  default_assumptions=excluded.default_assumptions,
  updated_at=now();

insert into public.sealed_native_booster_verifications
  (set_code,booster_code,config_fingerprint,verification_status,official_source_url,verified_at,verification_notes)
values
  ('ACR','default','9812dcb8ef58a98a796a7d293a408eca','verified',
   'https://magic.wizards.com/en/news/feature/collecting-assassins-creed','2026-09-02T21:15:00Z',
   '{"product":"Beyond Booster","official_slots_checked":true,"checks":["3 uncommons","land or scene-card slot","rare or mythic rare","traditional foil of any rarity","Booster Fun slot","token or art card"]}'),
  ('ACR','collector','8e64d7fe03edf351e8a9337cbb6b77f2','verified',
   'https://magic.wizards.com/en/news/feature/collecting-assassins-creed','2026-09-02T21:15:00Z',
   '{"product":"Collector Booster","official_slots_checked":true,"checks":["traditional foil uncommons","memory corridor uncommon","foil-etched uncommon","land or scene-card slot","traditional foil rare or mythic rare","extended-art rare or mythic rare","alternate-frame slot","foil-etched rare or mythic rare","traditional foil token"]}')
on conflict(set_code,booster_code) do update set
  config_fingerprint=excluded.config_fingerprint,
  verification_status=excluded.verification_status,
  official_source_url=excluded.official_source_url,
  verified_at=excluded.verified_at,
  verification_notes=excluded.verification_notes,
  updated_at=now();
