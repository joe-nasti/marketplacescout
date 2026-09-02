insert into public.sealed_collation_adapters
  (adapter_key,adapter_family,display_name,model_kind,reusable_across_sets,description,default_assumptions)
values
  ('collector_sample_mtgjson_v1','collector_sample','Collector Booster Sample Pack · native sheets','probabilistic_pack',true,
   'Two-card Collector Booster sample pack driven by official slot identities and native weighted sheets',
   '{"requires_official_slot_identity":true,"requires_official_finish_probability_for_full":true}')
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
  ('CMM','collector-sample','c40cebed452a9d806d8c1ef1d26bfc04','partial',
   'https://magic.wizards.com/en/news/feature/collecting-commander-masters',now(),
   '{"official_slots_checked":true,"checks":["1 nonfoil or traditional foil extended-art or borderless rare/mythic","1 traditional foil borderless common/uncommon"],"unverified_native_assumption":"MTGJSON encodes the rare/mythic finish mix as 50% nonfoil and 50% traditional foil; Wizards does not publish that rate"}')
on conflict(set_code,booster_code) do update set
  config_fingerprint=excluded.config_fingerprint,
  verification_status=excluded.verification_status,
  official_source_url=excluded.official_source_url,
  verified_at=excluded.verified_at,
  verification_notes=excluded.verification_notes,
  updated_at=now();
