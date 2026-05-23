'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Five-step onboarding form. Step state is local-only (no auto-save
 * between steps); the entire payload is POSTed on the last step. If
 * the user closes the tab mid-flow, they'll see the same form again
 * on next sign-in because onboarding_completed_at stays null.
 *
 * Steps:
 *   1. Basics — display name, timezone, DOB, sex, height, weight.
 *   2. Training history — experience level, weekly hours baseline,
 *      longest recent run (passed to coach later, not persisted).
 *   3. Health — repeatable injury rows + free-text health notes.
 *   4. Goal — primary_goal text + optional race seed.
 *   5. Connections — links to /settings/integrations (Strava / Apple /
 *      Oura). Submit happens from here too.
 */

type InjuryDraft = {
  bodyPart: string;
  startedAt: string;
  endedAt: string;
  notes: string;
  stillActive: boolean;
};

type FormState = {
  // step 1
  displayName: string;
  timezone: string;
  dateOfBirth: string;
  sex: 'male' | 'female' | '';
  heightCm: string;
  weightKg: string;
  // step 2
  experienceLevel: 'beginner' | 'building' | 'experienced' | '';
  weeklyTrainingHoursBaseline: string;
  longestRecentRunKm: string;
  // step 3
  injuries: InjuryDraft[];
  healthNotes: string;
  // step 4
  primaryGoal: string;
  raceName: string;
  raceDate: string;
  distanceKm: string;
  elevationGainM: string;
};

function defaultState(initialDisplayName: string): FormState {
  let timezone = 'UTC';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    /* leave UTC */
  }
  return {
    displayName: initialDisplayName,
    timezone,
    dateOfBirth: '',
    sex: '',
    heightCm: '',
    weightKg: '',
    experienceLevel: '',
    weeklyTrainingHoursBaseline: '',
    longestRecentRunKm: '',
    injuries: [],
    healthNotes: '',
    primaryGoal: '',
    raceName: '',
    raceDate: '',
    distanceKm: '',
    elevationGainM: '',
  };
}

type StepProps = {
  state: FormState;
  setState: React.Dispatch<React.SetStateAction<FormState>>;
};

const inputClass =
  'mt-1 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-muted focus:border-brand2/60';
const labelClass = 'block text-xs uppercase tracking-[0.18em] text-muted';

function Step1Basics({ state, setState }: StepProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label>
          <span className={labelClass}>Display name</span>
          <input
            type="text"
            className={inputClass}
            value={state.displayName}
            onChange={(e) => setState((s) => ({ ...s, displayName: e.target.value }))}
          />
        </label>
        <label>
          <span className={labelClass}>Timezone</span>
          <input
            type="text"
            className={inputClass}
            value={state.timezone}
            onChange={(e) => setState((s) => ({ ...s, timezone: e.target.value }))}
            placeholder="America/Denver"
          />
        </label>
        <label>
          <span className={labelClass}>Date of birth</span>
          <input
            type="date"
            className={inputClass}
            value={state.dateOfBirth}
            onChange={(e) => setState((s) => ({ ...s, dateOfBirth: e.target.value }))}
          />
        </label>
        <label>
          <span className={labelClass}>Sex</span>
          <select
            className={inputClass}
            value={state.sex}
            onChange={(e) =>
              setState((s) => ({ ...s, sex: e.target.value as FormState['sex'] }))
            }
          >
            <option value="">Prefer not to say</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </label>
        <label>
          <span className={labelClass}>Height (cm)</span>
          <input
            type="number"
            min="0"
            step="0.1"
            className={inputClass}
            value={state.heightCm}
            onChange={(e) => setState((s) => ({ ...s, heightCm: e.target.value }))}
            placeholder="178"
          />
        </label>
        <label>
          <span className={labelClass}>Weight (kg)</span>
          <input
            type="number"
            min="0"
            step="0.1"
            className={inputClass}
            value={state.weightKg}
            onChange={(e) => setState((s) => ({ ...s, weightKg: e.target.value }))}
            placeholder="72"
          />
        </label>
      </div>
    </div>
  );
}

function Step2Training({ state, setState }: StepProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label>
          <span className={labelClass}>Experience level</span>
          <select
            className={inputClass}
            value={state.experienceLevel}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                experienceLevel: e.target.value as FormState['experienceLevel'],
              }))
            }
          >
            <option value="">Pick one</option>
            <option value="beginner">Beginner — new to structured training</option>
            <option value="building">Building — consistent for months, not years</option>
            <option value="experienced">Experienced — years of structured training</option>
          </select>
        </label>
        <label>
          <span className={labelClass}>Weekly training hours (baseline)</span>
          <input
            type="number"
            min="0"
            step="0.5"
            className={inputClass}
            value={state.weeklyTrainingHoursBaseline}
            onChange={(e) =>
              setState((s) => ({ ...s, weeklyTrainingHoursBaseline: e.target.value }))
            }
            placeholder="6"
          />
        </label>
        <label className="md:col-span-2">
          <span className={labelClass}>Longest recent run (km, optional)</span>
          <input
            type="number"
            min="0"
            step="0.5"
            className={inputClass}
            value={state.longestRecentRunKm}
            onChange={(e) => setState((s) => ({ ...s, longestRecentRunKm: e.target.value }))}
            placeholder="30"
          />
          <span className="mt-1 block text-xs text-muted">
            Helps the coach calibrate where to start your build. Not stored on your profile — passed to the coach as conversation context.
          </span>
        </label>
      </div>
    </div>
  );
}

function Step3Health({ state, setState }: StepProps) {
  const addInjury = () =>
    setState((s) => ({
      ...s,
      injuries: [
        ...s.injuries,
        { bodyPart: '', startedAt: '', endedAt: '', notes: '', stillActive: false },
      ],
    }));
  const updateInjury = (idx: number, patch: Partial<InjuryDraft>) =>
    setState((s) => ({
      ...s,
      injuries: s.injuries.map((inj, i) => (i === idx ? { ...inj, ...patch } : inj)),
    }));
  const removeInjury = (idx: number) =>
    setState((s) => ({ ...s, injuries: s.injuries.filter((_, i) => i !== idx) }));

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted">
        Add any past injuries the coach should know about. Skip if you don&apos;t have any — you can tell the coach about new ones in chat.
      </p>
      <div className="space-y-3">
        {state.injuries.map((inj, idx) => (
          <div key={idx} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <div className="grid gap-3 md:grid-cols-4">
              <label className="md:col-span-2">
                <span className={labelClass}>Body part</span>
                <input
                  type="text"
                  className={inputClass}
                  value={inj.bodyPart}
                  onChange={(e) => updateInjury(idx, { bodyPart: e.target.value })}
                  placeholder="left hamstring"
                />
              </label>
              <label>
                <span className={labelClass}>Started</span>
                <input
                  type="date"
                  className={inputClass}
                  value={inj.startedAt}
                  onChange={(e) => updateInjury(idx, { startedAt: e.target.value })}
                />
              </label>
              <label>
                <span className={labelClass}>Ended (blank if active)</span>
                <input
                  type="date"
                  className={inputClass}
                  value={inj.endedAt}
                  disabled={inj.stillActive}
                  onChange={(e) => updateInjury(idx, { endedAt: e.target.value })}
                />
              </label>
              <label className="md:col-span-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={inj.stillActive}
                  onChange={(e) =>
                    updateInjury(idx, {
                      stillActive: e.target.checked,
                      endedAt: e.target.checked ? '' : inj.endedAt,
                    })
                  }
                />
                <span className="text-sm text-muted">Still active</span>
              </label>
              <label className="md:col-span-4">
                <span className={labelClass}>Notes (optional)</span>
                <input
                  type="text"
                  className={inputClass}
                  value={inj.notes}
                  onChange={(e) => updateInjury(idx, { notes: e.target.value })}
                  placeholder="6 weeks off, returned at 80% volume"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => removeInjury(idx)}
              className="mt-3 text-xs uppercase tracking-[0.18em] text-amber-300"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addInjury}
          className="rounded-full border border-white/15 px-4 py-2 text-sm text-white hover:border-brand2/60"
        >
          + Add injury
        </button>
      </div>
      <label>
        <span className={labelClass}>Health notes (chronic conditions, meds, allergies, surgeries)</span>
        <textarea
          rows={3}
          className={inputClass}
          value={state.healthNotes}
          onChange={(e) => setState((s) => ({ ...s, healthNotes: e.target.value }))}
          placeholder="e.g., mild asthma — albuterol as needed; LCL repair on right knee 2019"
        />
      </label>
    </div>
  );
}

function Step4Goal({ state, setState }: StepProps) {
  return (
    <div className="space-y-4">
      <label>
        <span className={labelClass}>Primary goal</span>
        <textarea
          rows={3}
          className={inputClass}
          value={state.primaryGoal}
          onChange={(e) => setState((s) => ({ ...s, primaryGoal: e.target.value }))}
          placeholder="Place top 10 at the Swiss Alps 100 in August 2026. Long-term: stay healthy and competitive into my 50s."
        />
        <span className="mt-1 block text-xs text-muted">
          Free text. The coach uses this to choose how aggressively to push you. Be specific about what success looks like.
        </span>
      </label>
      <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-brand2">Already have a target race? (optional)</p>
        <p className="mt-1 text-sm text-muted">
          Fill these in and the coach will use them as the starting point for your first plan. Skip if you&apos;re just trying to get fitter.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="md:col-span-2">
            <span className={labelClass}>Race name</span>
            <input
              type="text"
              className={inputClass}
              value={state.raceName}
              onChange={(e) => setState((s) => ({ ...s, raceName: e.target.value }))}
              placeholder="Swiss Alps 100"
            />
          </label>
          <label>
            <span className={labelClass}>Race date</span>
            <input
              type="date"
              className={inputClass}
              value={state.raceDate}
              onChange={(e) => setState((s) => ({ ...s, raceDate: e.target.value }))}
            />
          </label>
          <label>
            <span className={labelClass}>Distance (km)</span>
            <input
              type="number"
              min="0"
              step="0.1"
              className={inputClass}
              value={state.distanceKm}
              onChange={(e) => setState((s) => ({ ...s, distanceKm: e.target.value }))}
              placeholder="160"
            />
          </label>
          <label className="md:col-span-2">
            <span className={labelClass}>Elevation gain (m)</span>
            <input
              type="number"
              min="0"
              step="1"
              className={inputClass}
              value={state.elevationGainM}
              onChange={(e) => setState((s) => ({ ...s, elevationGainM: e.target.value }))}
              placeholder="9000"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function Step5Connect() {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted">
        The coach reads workouts from Apple Health and Strava, recovery from Oura, and labs you upload directly. Connect what you have — you can do the rest later from Settings → Integrations.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <a
          href="/settings/integrations"
          className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 hover:border-brand2/60"
        >
          <p className="text-xs uppercase tracking-[0.18em] text-brand2">Strava</p>
          <p className="mt-1 text-sm text-white">Connect →</p>
        </a>
        <a
          href="/settings/integrations"
          className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 hover:border-brand2/60"
        >
          <p className="text-xs uppercase tracking-[0.18em] text-brand2">Apple Health</p>
          <p className="mt-1 text-sm text-white">Get signed URL →</p>
        </a>
        <a
          href="/settings/integrations"
          className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 hover:border-brand2/60"
        >
          <p className="text-xs uppercase tracking-[0.18em] text-brand2">Oura</p>
          <p className="mt-1 text-sm text-white">Connect →</p>
        </a>
      </div>
      <p className="text-xs text-muted">
        These open in this same tab. Use the back button if you want to come back and finish onboarding without setting one up yet.
      </p>
    </div>
  );
}

const STEPS: Array<{ title: string; render: (props: StepProps) => React.ReactNode }> = [
  { title: 'Basics', render: (p) => <Step1Basics {...p} /> },
  { title: 'Training history', render: (p) => <Step2Training {...p} /> },
  { title: 'Health', render: (p) => <Step3Health {...p} /> },
  { title: 'Goal', render: (p) => <Step4Goal {...p} /> },
  { title: 'Connections', render: () => <Step5Connect /> },
];

export function OnboardingFlow({
  initialDisplayName,
  initialEmail,
}: {
  initialDisplayName: string;
  initialEmail: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => defaultState(initialDisplayName));
  const [stepIndex, setStepIndex] = useState(0);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isLast = stepIndex === STEPS.length - 1;
  const isFirst = stepIndex === 0;

  function buildPayload() {
    const profile = {
      displayName: state.displayName.trim() || null,
      timezone: state.timezone.trim() || null,
      dateOfBirth: state.dateOfBirth || null,
      sex: state.sex || null,
      heightCm: state.heightCm ? Number(state.heightCm) : null,
      weightKg: state.weightKg ? Number(state.weightKg) : null,
      experienceLevel: state.experienceLevel || null,
      weeklyTrainingHoursBaseline: state.weeklyTrainingHoursBaseline
        ? Number(state.weeklyTrainingHoursBaseline)
        : null,
      primaryGoal: state.primaryGoal.trim() || null,
      healthNotes: state.healthNotes.trim() || null,
    };
    const injuries = state.injuries
      .filter((inj) => inj.bodyPart.trim() && inj.startedAt)
      .map((inj) => ({
        bodyPart: inj.bodyPart.trim(),
        startedAt: inj.startedAt,
        endedAt: inj.stillActive || !inj.endedAt ? undefined : inj.endedAt,
        notes: inj.notes.trim() || undefined,
      }));
    const raceSeed =
      state.raceName.trim() && state.raceDate
        ? {
            raceName: state.raceName.trim(),
            raceDate: state.raceDate,
            distanceKm: state.distanceKm ? Number(state.distanceKm) : undefined,
            elevationGainM: state.elevationGainM ? Number(state.elevationGainM) : undefined,
          }
        : undefined;
    return { profile, injuries, raceSeed };
  }

  async function handleSubmit() {
    setStatus('submitting');
    setErrorMessage(null);
    try {
      const response = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        raceSeed?: { raceName: string; raceDate: string } | null;
      };
      if (!response.ok || !data.ok) {
        setStatus('error');
        setErrorMessage(data.error ?? `Request failed (${response.status})`);
        return;
      }
      // Stash race seed in sessionStorage so /coach can read it on mount
      // and offer the first plan-creation prompt. Falls back to a plain
      // redirect when no seed.
      try {
        if (data.raceSeed) {
          sessionStorage.setItem('onboarding.raceSeed', JSON.stringify(data.raceSeed));
        } else {
          sessionStorage.removeItem('onboarding.raceSeed');
        }
      } catch {
        /* sessionStorage unavailable — coach can still ask conversationally */
      }
      router.push('/coach');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Network error');
    }
  }

  const submitting = status === 'submitting';

  return (
    <div className="space-y-6">
      <p className="text-xs uppercase tracking-[0.18em] text-muted">
        Signed in as {initialEmail}
      </p>

      <ol className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em]">
        {STEPS.map((step, idx) => (
          <li
            key={step.title}
            className={
              idx === stepIndex
                ? 'rounded-full bg-brand2 px-3 py-1 text-black'
                : idx < stepIndex
                ? 'rounded-full border border-brand2/40 px-3 py-1 text-brand2'
                : 'rounded-full border border-white/10 px-3 py-1 text-muted'
            }
          >
            {idx + 1}. {step.title}
          </li>
        ))}
      </ol>

      <div>
        <h2 className="text-xl font-semibold text-white">{STEPS[stepIndex].title}</h2>
        <div className="mt-4">{STEPS[stepIndex].render({ state, setState })}</div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          disabled={isFirst || submitting}
          className="rounded-full border border-white/15 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          Back
        </button>
        {isLast ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Finish onboarding'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}
            disabled={submitting}
            className="rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black"
          >
            Next
          </button>
        )}
      </div>

      {errorMessage ? (
        <p className="text-sm text-red-300">{errorMessage}</p>
      ) : null}
    </div>
  );
}
