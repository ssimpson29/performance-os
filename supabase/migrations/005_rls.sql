alter table public.users enable row level security;
alter table public.user_integrations enable row level security;
alter table public.sync_runs enable row level security;
alter table public.training_plans enable row level security;
alter table public.planned_sessions enable row level security;
alter table public.workouts enable row level security;
alter table public.plan_workout_matches enable row level security;
alter table public.recovery_daily enable row level security;
alter table public.health_events enable row level security;
alter table public.lab_panels enable row level security;
alter table public.biomarker_results enable row level security;
alter table public.daily_summaries enable row level security;

drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users
for select using (auth.uid() = id);

drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users
for update using (auth.uid() = id);

drop policy if exists user_integrations_own_all on public.user_integrations;
create policy user_integrations_own_all on public.user_integrations
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists sync_runs_own_all on public.sync_runs;
create policy sync_runs_own_all on public.sync_runs
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists training_plans_own_all on public.training_plans;
create policy training_plans_own_all on public.training_plans
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists planned_sessions_own_all on public.planned_sessions;
create policy planned_sessions_own_all on public.planned_sessions
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists workouts_own_all on public.workouts;
create policy workouts_own_all on public.workouts
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists plan_workout_matches_own_all on public.plan_workout_matches;
create policy plan_workout_matches_own_all on public.plan_workout_matches
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists recovery_daily_own_all on public.recovery_daily;
create policy recovery_daily_own_all on public.recovery_daily
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists health_events_own_all on public.health_events;
create policy health_events_own_all on public.health_events
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists lab_panels_own_all on public.lab_panels;
create policy lab_panels_own_all on public.lab_panels
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists biomarker_results_own_all on public.biomarker_results;
create policy biomarker_results_own_all on public.biomarker_results
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists daily_summaries_own_all on public.daily_summaries;
create policy daily_summaries_own_all on public.daily_summaries
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
