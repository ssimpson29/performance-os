# Performance OS — Privacy Policy & Data Disclosure (DRAFT)

> **⚠️ This is a working draft, not legal advice.** It documents how the app
> actually handles data today so a qualified attorney can turn it into a
> binding policy. Replace the `{{PLACEHOLDERS}}` and get it reviewed before
> relying on it for a paid product. Last updated: 2026-06-01.

**Operator:** {{LEGAL_ENTITY_NAME}} ("we", "us")
**Contact:** {{PRIVACY_CONTACT_EMAIL}}
**Service:** Performance OS — a personal training + longevity coaching app.

---

## 1. What this app is (and isn't)

Performance OS provides **evidence-informed coaching**, not medical advice. It
does not diagnose, treat, or prevent any condition. Clinically out-of-range lab
values should be reviewed with a licensed physician. You are responsible for
decisions made using the app.

## 2. Data we collect

| Category | Examples | Source |
| --- | --- | --- |
| Account | Email, athlete profile (DOB, sex, height, weight, timezone, goals, experience, health notes) | You / sign-up |
| Training | Workouts: type, duration, distance, pace, HR, power, elevation, cadence, RPE, descriptions | Apple Health, Strava |
| Recovery | Readiness, sleep, HRV, resting HR, respiratory rate, temperature | Oura |
| Biomarkers | Lab/blood panel values + dates | You (upload), vision extraction of lab PDFs/images |
| Health history | Injuries, conditions, medications you record | You |
| Conversations | Your messages to the Coach + Longevity Guru and their replies | In-app |
| Usage/billing | Per-request LLM token counts + estimated cost (`llm_usage`) | System |

Some of this is **health data**. We collect it only to provide the coaching
features you ask for.

## 3. How we use it

- To run the coaching engine and generate your training/longevity guidance.
- To show you your own data (recovery trends, plan, today's session).
- To operate, secure, and improve the service.

We do **not** sell your data. We do **not** use Apple Health data for
advertising or data-mining. We do not use your data to train our own models.

## 4. Third parties that process your data

To deliver the service we share data with these processors:

- **Hosting / database:** {{HOSTING_PROVIDER}} (Vercel) and Supabase store your
  account and health data.
- **AI provider (important):** The Coach and Longevity Guru send relevant
  training, recovery, biomarker, and conversation data to a third-party,
  OpenAI-compatible large-language-model API ({{LLM_PROVIDER}}) to generate
  responses. Under that provider's API terms, data sent via the API is **not
  used to train their models** and is retained only transiently for abuse
  monitoring per their policy. We request this processing only after you
  consent (see §6).
- **Wearable/activity providers:** Oura and Strava, via OAuth you authorize,
  to import your data.

We require each processor to handle your data under their terms; we link their
policies at {{PROCESSOR_LINKS}}.

## 5. Provider-specific terms

- **Apple Health (HealthKit):** Health data imported from Apple Health is used
  solely to provide you health/fitness features, is never used for advertising
  or sold, and is shared with the AI provider (§4) only with your consent.
- **Strava:** We display your Strava data only to you. If you disconnect Strava
  (in-app or by revoking us in Strava), we revoke our authorization and
  **delete the Strava-sourced data** we stored. "View on Strava" / attribution
  per Strava's brand guidelines.
- **Oura:** Recovery data is imported via OAuth and used only for your
  coaching. Disconnecting Oura deletes the Oura-sourced data we stored.

## 6. Your consent to AI processing

Before the coaching agents process your health data through the third-party AI
provider, we ask for explicit consent (recorded with a version + timestamp). You
can review the disclosure and consent on **Settings → Integrations**. If we
materially change how AI processing works, we re-request consent.

## 7. Retention & deletion

- **Disconnect a source:** deletes the data we synced from that provider
  (Oura → recovery rows; Strava → workout rows) and our stored tokens.
- **Delete your account:** removes your profile and associated data. Request via
  {{PRIVACY_CONTACT_EMAIL}}. {{ACCOUNT_DELETION_MECHANISM}}.
- We retain data only as long as needed to provide the service or meet legal
  obligations.

## 8. Your rights

Depending on your jurisdiction (e.g. GDPR/UK GDPR, CCPA/CPRA) you may have rights
to access, correct, export, or delete your data, and to withdraw consent.
Exercise them via {{PRIVACY_CONTACT_EMAIL}}.

## 9. Security

Access is athlete-scoped: you can only read/write your own data. Tokens and
secrets are stored server-side. We use TLS in transit. No system is perfectly
secure; we cannot guarantee absolute security.

## 10. Children

Not directed to anyone under {{MIN_AGE}}. We do not knowingly collect data from
children.

## 11. Changes

We will post updates here and, for material changes to data handling, re-request
consent where required.

---

### Engineering notes (keep in sync with the code)

- Consent capture: `lib/consent/ai-consent.ts` + `POST/GET /api/consent/ai-data`,
  versioned by `AI_DATA_CONSENT_VERSION`. Disclosure UI: `AiConsentCard` on
  `/settings/integrations`.
- Disconnect-deletes-data: `lib/integrations/disconnect.ts` +
  `POST /api/integrations/disconnect`. Strava also revokes at Strava
  (`lib/strava/deauthorize.ts`) and honors Strava's deauthorization webhook
  (`/api/webhooks/strava`).
- **Open before this is launch-ready:** confirm the AI provider's no-train /
  retention terms in writing and name them in §4; resolve Strava's API-agreement
  AI-use clause; implement an in-app account-deletion mechanism (§7); legal
  review of the whole document.
