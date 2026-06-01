-- 011_llm_usage.sql
--
-- Per-call LLM spend ledger. Each agent run (coach chat, longevity chat,
-- Today's Call composer, ...) inserts one row with token counts + an estimated
-- USD cost. Powers per-user spend dashboards/billing and the daily spend
-- ceiling (lib/agents/llm-usage.ts). Writes are server-side via the service
-- role; reads are own-row only.
--
-- See "LLM cost controls" in CLAUDE.md.

create table if not exists public.llm_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  surface text not null,
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  iterations integer not null default 0,
  est_cost_usd numeric(10, 6) not null default 0,
  created_at timestamptz not null default now()
);

-- Drives the "spend today for this user" sum and per-user history.
create index if not exists llm_usage_user_created_idx
  on public.llm_usage (user_id, created_at desc);

alter table public.llm_usage enable row level security;

-- Athletes can read their own usage (future in-app spend view). Inserts come
-- from the service-role server client, which bypasses RLS — no insert policy
-- for end users by design (usage is a system-written audit row).
drop policy if exists llm_usage_select_own on public.llm_usage;
create policy llm_usage_select_own on public.llm_usage
  for select using (auth.uid() = user_id);

comment on table public.llm_usage is
  'Per-call LLM token + estimated-cost ledger. Server-written; powers spend dashboards and the daily spend ceiling.';
