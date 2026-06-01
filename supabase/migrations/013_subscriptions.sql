-- 013_subscriptions.sql
--
-- Subscription / entitlement state for the paywall. Processor-agnostic: a
-- billing provider's webhook (Stripe first; PayPal possible later) syncs the
-- subscription lifecycle into these columns, and the app gates premium
-- features on subscription_status (lib/billing/entitlement.ts).
--
-- The paid line is "free basics, paid AI": the LLM surfaces (coach chat,
-- longevity guru, Today's Call, plan creation, lab vision) require an active
-- subscription when the paywall is enabled.

alter table public.users
  add column if not exists subscription_status text,
  add column if not exists subscription_plan text,
  add column if not exists subscription_period_end timestamptz,
  add column if not exists billing_provider text,
  add column if not exists billing_customer_id text,
  add column if not exists billing_subscription_id text;

-- Look up the local user from a billing webhook by the provider's customer id.
create index if not exists users_billing_customer_idx
  on public.users (billing_customer_id)
  where billing_customer_id is not null;

comment on column public.users.subscription_status is
  'Billing-provider subscription status: active | trialing | past_due | canceled | null. active/trialing grant premium access.';
comment on column public.users.subscription_period_end is
  'End of the current paid period; access may be honored through this even if status later lapses.';
comment on column public.users.billing_provider is
  'Which processor owns this subscription (e.g. stripe). Lets a future second processor coexist.';
