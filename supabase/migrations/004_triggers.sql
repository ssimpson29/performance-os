drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists user_integrations_set_updated_at on public.user_integrations;
create trigger user_integrations_set_updated_at before update on public.user_integrations
for each row execute function public.set_updated_at();

drop trigger if exists training_plans_set_updated_at on public.training_plans;
create trigger training_plans_set_updated_at before update on public.training_plans
for each row execute function public.set_updated_at();

drop trigger if exists planned_sessions_set_updated_at on public.planned_sessions;
create trigger planned_sessions_set_updated_at before update on public.planned_sessions
for each row execute function public.set_updated_at();

drop trigger if exists workouts_set_updated_at on public.workouts;
create trigger workouts_set_updated_at before update on public.workouts
for each row execute function public.set_updated_at();

drop trigger if exists recovery_daily_set_updated_at on public.recovery_daily;
create trigger recovery_daily_set_updated_at before update on public.recovery_daily
for each row execute function public.set_updated_at();

drop trigger if exists health_events_set_updated_at on public.health_events;
create trigger health_events_set_updated_at before update on public.health_events
for each row execute function public.set_updated_at();

drop trigger if exists lab_panels_set_updated_at on public.lab_panels;
create trigger lab_panels_set_updated_at before update on public.lab_panels
for each row execute function public.set_updated_at();

drop trigger if exists biomarker_results_set_updated_at on public.biomarker_results;
create trigger biomarker_results_set_updated_at before update on public.biomarker_results
for each row execute function public.set_updated_at();

drop trigger if exists daily_summaries_set_updated_at on public.daily_summaries;
create trigger daily_summaries_set_updated_at before update on public.daily_summaries
for each row execute function public.set_updated_at();
