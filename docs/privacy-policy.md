# Performance OS — Privacy Policy & Data Disclosure (DRAFT)

> **⚠️ This is a working draft, not legal advice.** It documents how the app
> actually handles data today so a qualified attorney can turn it into a
> binding policy. Operator-specific fields are filled in; get the whole
> document reviewed before relying on it for a paid product. Last updated:
> 2026-06-01.

**Operator:** Blue Ocean Reach ("we", "us")
**Contact:** scott@spsimpson.net
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

- **Hosting / database:** Vercel (application hosting) and Supabase (database +
  auth) store your account and health data.
- **AI provider (important):** The Coach and Longevity Guru send relevant
  training, recovery, biomarker, and conversation data to **OpenAI** (via its
  OpenAI-compatible chat-completions API) to generate responses. Per OpenAI's
  API data-usage policy, data submitted through the API is **not used to train
  OpenAI's models** and is retained only transiently for abuse monitoring. We
  request this processing only after you consent (see §6).
- **Wearable/activity providers:** Oura and Strava, via OAuth you authorize,
  to import your data.

We require each processor to handle your data under their terms. Their privacy
policies: OpenAI (openai.com/policies/privacy-policy), Vercel
(vercel.com/legal/privacy-policy), Supabase (supabase.com/privacy), Oura
(ouraring.com/privacy-policy), Strava (strava.com/legal/privacy).

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
- **Delete your account:** removes your profile and associated data. Currently
  handled manually on request via scott@spsimpson.net; a self-serve in-app
  account deletion is planned.
- We retain data only as long as needed to provide the service or meet legal
  obligations.

## 8. Your rights

Depending on your jurisdiction (e.g. GDPR/UK GDPR, CCPA/CPRA) you may have rights
to access, correct, export, or delete your data, and to withdraw consent.
Exercise them via scott@spsimpson.net.

## 9. Security

Access is athlete-scoped: you can only read/write your own data. Tokens and
secrets are stored server-side. We use TLS in transit. No system is perfectly
secure; we cannot guarantee absolute security.

## 10. Children

Not directed to anyone under 18. We do not knowingly collect data from anyone
under 18.

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
- **Open before this is launch-ready:**
  1. Resolve Strava's API-agreement AI-use clause — see `docs/strava-ai-use-inquiry.md`.
  2. Confirm OpenAI's no-train / retention terms apply to your account tier in
     writing (Enterprise/zero-retention may differ from the API default).
  3. Implement an in-app account-deletion mechanism (§7 currently says manual).
  4. Legal review of the whole document + your jurisdiction's requirements.
