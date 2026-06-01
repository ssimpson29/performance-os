# Strava API — AI-use clause: the question, and how to get it answered

> Not legal advice. This frames the one Strava-terms question that gates
> charging for an AI coach built on Strava data, gives you a ready-to-send
> inquiry, and lists interim mitigations.

## The issue

Strava's API Agreement (tightened in 2024) restricts how third parties may use
Strava data. Two clauses matter for us:

1. **AI/ML restriction** — the Agreement limits using Strava data to train or
   develop machine-learning / AI models. Our product feeds Strava activity data
   into an LLM **as inference context** (we don't train a model on it), which
   sits in a gray area Strava has interpreted narrowly.
2. **Display-to-others / data-retention** — Strava data may only be shown to the
   authenticated athlete, and must not be retained after disconnect. ✅ We
   already satisfy both (athlete-scoped reads; disconnect + deauthorization
   webhook delete Strava data — `lib/integrations/disconnect.ts`,
   `lib/strava/deauthorize.ts`).

The open question is **#1**: *is sending an athlete's own Strava data to a
third-party LLM, purely to generate that same athlete's coaching response (no
model training, no cross-athlete aggregation, output shown only to that
athlete), permitted under the current API Agreement?*

## Ready-to-send inquiry (developers@strava.com / developer support)

> Subject: API Agreement — clarification on LLM inference use of athlete's own data
>
> Hi Strava team,
>
> I operate a personal coaching app (Blue Ocean Reach / Performance OS) where an
> athlete connects their own Strava account. To generate that athlete's
> individual coaching guidance, we send their own activity data to a
> third-party large-language-model API (OpenAI) as inference context only.
>
> Specifically:
> - We do **not** train, fine-tune, or develop any ML/AI model on Strava data.
> - Data is used transiently as prompt context to produce a response for the
>   same athlete who authorized us; output is shown only to that athlete.
> - We do not aggregate Strava data across athletes.
> - We delete Strava-sourced data on disconnect and honor the athlete
>   deauthorization webhook.
>
> Is this inference-only use permitted under the current API Agreement, or does
> the AI/ML clause prohibit sending Strava data to a third-party LLM even for
> single-athlete inference? If it's restricted, is there an approved path
> (e.g. a commercial agreement) for this use case?
>
> Thanks, Scott

Send via the Strava developer portal support and/or developers@strava.com. Keep
the written reply on file — it's the evidence the privacy policy (§4/§5) and any
investor/legal review will want.

## Interim mitigations (so a Strava clampdown can't sink the product)

- **Make Strava optional.** The product is fully valuable on **Apple Health +
  Oura + lab uploads**, where consent (§6) clears the third-party-LLM path.
  Treat Strava as a convenience source, not a dependency.
- **Already done:** disconnect/deauth deletion, athlete-scoped display,
  explicit AI-data consent capture (`AI_REQUIRE_DATA_CONSENT`).
- **If Strava says no to LLM use:** gate Strava-sourced fields out of the LLM
  context (keep them for the deterministic engine + the athlete's own display
  only), or drop the Strava integration. The data layer already tags source
  (`workouts.source='strava'`), so filtering Strava rows out of the LLM context
  loader is a contained change if needed.

## Status

- Code-side Strava compliance (deletion, revoke, display scope): ✅ done.
- AI-use determination: ⬜ awaiting Strava's written answer to the inquiry above.
