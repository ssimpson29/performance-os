-- 012_ai_data_consent.sql
--
-- Records the athlete's explicit consent to have their wearable / health /
-- lab data processed by a third-party LLM (the AI coach + longevity guru run
-- on an OpenAI-compatible API). Apple HealthKit (Guideline 5.1.3) and the
-- wearable providers require explicit consent before sharing health data with
-- a third party — this is the audit record for that.
--
-- Versioned: bumping AI_DATA_CONSENT_VERSION (lib/consent/ai-consent.ts)
-- invalidates prior consent so the athlete must re-accept an updated notice.

alter table public.users
  add column if not exists ai_data_consent_at timestamptz,
  add column if not exists ai_data_consent_version text;

comment on column public.users.ai_data_consent_at is
  'When the athlete consented to third-party-LLM processing of their health data. NULL = never consented.';
comment on column public.users.ai_data_consent_version is
  'The consent-notice version accepted. Compared against AI_DATA_CONSENT_VERSION; a mismatch means re-consent is required.';
