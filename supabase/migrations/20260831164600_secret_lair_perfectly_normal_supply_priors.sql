update public.secret_lair_drops d
set supply_prior=case
      when d.drop_name in ('Secret Lair x Marvel: Dan Hipp','Secret Lair x Marvel: Earth''s Mightiest Pets','Secret Lair x Marvel: Hulk SMASH!','Secret Lair x Marvel: True Believers in Love','Secret Lair x Lofi Girl: Beats to Cast To') then 'high'
      else 'typical'
    end,
    supply_prior_confidence=case
      when d.drop_name like 'Secret Lair x Marvel:%' then 0.65
      when d.drop_name='Secret Lair x Lofi Girl: Beats to Cast To' then 0.55
      when d.drop_name='Artist Series: Ian Miller' then 0.55
      else 0.45
    end,
    supply_prior_rationale=case
      when d.drop_name like 'Secret Lair x Marvel:%' then 'Licensed/Universes Beyond-style collaboration; historical Secret Lair observations suggest these categories can receive materially larger print/allocation pools than ordinary artist drops. Qualitative prior only; no unit count inferred.'
      when d.drop_name='Secret Lair x Lofi Girl: Beats to Cast To' then 'Licensed fandom collaboration; historical behavior suggests branded collaborations may receive larger pools than ordinary artist drops. Qualitative prior only; no unit count inferred.'
      else 'MTG-native/artist-style drop; use a typical starting-supply prior until stronger historical allocation evidence is available.'
    end,
    supply_prior_source='historical_operator_prior_v1'
where d.release_id in (
  select release_id from public.secret_lair_releases
  where release_name='Secret Lair: A Perfectly Normal Superdrop'
);
