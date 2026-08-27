-- Deterministic guardrail beneath creator-video model extraction.
-- Keeps obvious deck-context identity matches from becoming market signals when the passage is only play-by-play.
create or replace function public.market_intel_video_event_quality_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_text text := lower(coalesce(new.evidence, ''));
  v_is_basic_land boolean := false;
  v_has_evaluation boolean := false;
begin
  select lower(e.entity_name)
    into v_name
  from public.market_intel_entities e
  where e.intel_id = new.intel_id
    and e.user_id = new.user_id
    and e.entity_type = 'card'
  limit 1;

  v_is_basic_land := v_name in ('plains','island','swamp','mountain','forest','wastes');
  v_has_evaluation := v_text ~ '(mandatory|perfect tool|makes a lot of sense|had success|really powerful|really good|fits.{0,50}well|impress|underperform|keep|cut|trim|go down|go up|more copies|fewer copies|synerg|best card|worst card|strong|weak)';

  if v_is_basic_land and not v_has_evaluation then
    update public.market_intel_items
       set signal_stage = 'noise',
           direction = 'neutral',
           metadata_json = coalesce(metadata_json, '{}'::jsonb)
             || jsonb_build_object('video_quality_gate', 'routine_basic_land')
     where intel_id = new.intel_id and user_id = new.user_id;

    delete from public.market_intel_video_events
     where video_event_id = new.video_event_id;
  end if;

  return null;
end
$$;

drop trigger if exists trg_market_intel_video_event_quality_gate on public.market_intel_video_events;
create trigger trg_market_intel_video_event_quality_gate
after insert on public.market_intel_video_events
for each row execute function public.market_intel_video_event_quality_gate();
