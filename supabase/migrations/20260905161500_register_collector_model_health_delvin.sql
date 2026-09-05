-- Register the Collector Booster promotion dashboard as a shared web/Discord Delvin capability.
-- This route is diagnostic only; it never changes Scout grades, executable EV, or forecast authority.

insert into public.delvin_query_registry(
  query_key,prompt,category,aliases,ttl_seconds,sort_order,followups,
  capability_kind,route_key,clients,discoverable,context_scope,surface_type,
  async_enrichment,modifier_schema,description,matcher_priority,matcher_patterns
)
values(
  'collector_model_health',
  'How is the Collector Box model performing?',
  'Models',
  array[
    'collector box model health',
    'collector booster model performance',
    'is collector similarity ready for primary',
    'which collector lifecycle stages beat pooled'
  ],
  300,91,
  '["Is the Collector similarity model ready for PRIMARY?","Which lifecycle stages does the Collector model beat pooled on?"]'::jsonb,
  'dynamic','collector_model_health',array['web','discord'],true,'market','delvin_shared_report',false,
  '{}'::jsonb,
  'Leakage-safe pooled-versus-similarity Collector Booster model diagnostics by forecast horizon and lifecycle stage.',
  185,
  array[
    '(collector (box|booster).*(model|similarity).*(perform|performance|health|doing))',
    '(collector (box|booster).*(ready|eligible).*(primary))',
    '(collector (similarity|model).*(ready|eligible).*(primary))',
    '(collector (box|booster|model|similarity).*(lifecycle stages?|stages?).*(pooled|beat|win))',
    '(which lifecycle stages?.*(collector).*(pooled|beat|win))'
  ]::text[]
)
on conflict(query_key) do update set
  prompt=excluded.prompt,category=excluded.category,aliases=excluded.aliases,ttl_seconds=excluded.ttl_seconds,
  sort_order=excluded.sort_order,followups=excluded.followups,capability_kind=excluded.capability_kind,
  route_key=excluded.route_key,clients=excluded.clients,discoverable=excluded.discoverable,
  context_scope=excluded.context_scope,surface_type=excluded.surface_type,async_enrichment=excluded.async_enrichment,
  modifier_schema=excluded.modifier_schema,description=excluded.description,
  matcher_priority=excluded.matcher_priority,matcher_patterns=excluded.matcher_patterns,updated_at=now();

notify pgrst,'reload schema';
