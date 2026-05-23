'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Card } from '@/components/ui/card';
import type { AthleteProfile } from '@/lib/profile/profile-loader';
import type { AthleteSoul, SoulKind } from '@/lib/profile/soul-loader';

/**
 * Single-page editor for the account view. Composed of three sections:
 *
 *   1. Profile form — every field that lives on public.users (mirrors
 *      the onboarding form fields). Save calls PATCH /api/profile,
 *      which does NOT re-stamp onboarding_completed_at.
 *
 *   2. "What your coaches remember about you" — two collapsible
 *      <details> blocks (training + longevity soul). Each has a
 *      markdown textarea + Save button. Save calls PATCH /api/souls
 *      with { kind, content }. updatedBy on the server is 'athlete'.
 *
 *   3. Account actions — sign out. Email is shown for confirmation.
 */

const inputClass =
  'mt-1 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-muted focus:border-brand2/60';
const labelClass = 'block text-xs uppercase tracking-[0.18em] text-muted';

type ProfileFormState = {
  displayName: string;
  timezone: string;
  dateOfBirth: string;
  sex: 'male' | 'female' | '';
  heightCm: string;
  weightKg: string;
  experienceLevel: 'beginner' | 'building' | 'experienced' | '';
  weeklyTrainingHoursBaseline: string;
  primaryGoal: string;
  healthNotes: string;
};

function profileToForm(p: AthleteProfile): ProfileFormState {
  return {
    displayName: p.displayName ?? '',
    timezone: p.timezone ?? '',
    dateOfBirth: p.dateOfBirth ?? '',
    sex: p.sex ?? '',
    heightCm: p.heightCm != null ? String(p.heightCm) : '',
    weightKg: p.weightKg != null ? String(p.weightKg) : '',
    experienceLevel: p.experienceLevel ?? '',
    weeklyTrainingHoursBaseline:
      p.weeklyTrainingHoursBaseline != null ? String(p.weeklyTrainingHoursBaseline) : '',
    primaryGoal: p.primaryGoal ?? '',
    healthNotes: p.healthNotes ?? '',
  };
}

function formToPatch(s: ProfileFormState) {
  return {
    displayName: s.displayName.trim() || null,
    timezone: s.timezone.trim() || null,
    dateOfBirth: s.dateOfBirth || null,
    sex: s.sex || null,
    heightCm: s.heightCm ? Number(s.heightCm) : null,
    weightKg: s.weightKg ? Number(s.weightKg) : null,
    experienceLevel: s.experienceLevel || null,
    weeklyTrainingHoursBaseline: s.weeklyTrainingHoursBaseline
      ? Number(s.weeklyTrainingHoursBaseline)
      : null,
    primaryGoal: s.primaryGoal.trim() || null,
    healthNotes: s.healthNotes.trim() || null,
  };
}

type SoulSectionProps = {
  kind: SoulKind;
  title: string;
  description: string;
  initial: AthleteSoul;
};

function SoulSection({ kind, title, description, initial }: SoulSectionProps) {
  const [content, setContent] = useState(initial.content);
  const [savedAt, setSavedAt] = useState<string | null>(initial.updatedAt);
  const [savedBy, setSavedBy] = useState<string>(initial.updatedBy);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSave() {
    setStatus('saving');
    setErrorMessage(null);
    try {
      const response = await fetch('/api/souls', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, content }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        soul?: AthleteSoul;
        error?: string;
      };
      if (!response.ok || !data.ok || !data.soul) {
        setStatus('error');
        setErrorMessage(data.error ?? `Request failed (${response.status})`);
        return;
      }
      setSavedAt(data.soul.updatedAt);
      setSavedBy(data.soul.updatedBy);
      setStatus('saved');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Network error');
    }
  }

  return (
    <details className="rounded-2xl border border-white/10 bg-white/[0.03]">
      <summary className="cursor-pointer list-none p-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.18em] text-brand2">{title}</p>
          <p className="text-sm text-muted">{description}</p>
          <p className="text-xs text-muted">
            {savedAt
              ? `Last updated ${savedAt.slice(0, 10)} by ${savedBy}`
              : 'No notes yet — your coach will add some as you talk, or you can seed it here.'}
          </p>
        </div>
      </summary>
      <div className="space-y-3 border-t border-white/5 p-4">
        <label className={labelClass}>Markdown body</label>
        <textarea
          rows={10}
          className={inputClass}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={
            kind === 'longevity'
              ? "e.g. I trust Peter Attia and Paul Saladino on health topics — filter any recommendation through their perspective first. Prefer ancestral / animal-based framing on diet. Currently following a Zone 2 + ApoB-driven lipid strategy."
              : 'e.g. I prefer morning runs. Hate the treadmill. Always sandbag Tuesday quality. Get hurt when weeks exceed 70mi. Race goal: top 10 at Swiss Alps 100.'
          }
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {status === 'saving'
              ? 'Saving…'
              : status === 'saved'
              ? 'Saved.'
              : status === 'error'
              ? errorMessage
              : 'Your edits land as updated_by="athlete".'}
          </span>
          <button
            type="button"
            onClick={handleSave}
            disabled={status === 'saving'}
            className="rounded-full bg-brand2 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </details>
  );
}

export function AccountForm({
  email,
  initialProfile,
  initialTrainingSoul,
  initialLongevitySoul,
}: {
  email: string;
  initialProfile: AthleteProfile;
  initialTrainingSoul: AthleteSoul;
  initialLongevitySoul: AthleteSoul;
}) {
  const router = useRouter();
  const [state, setState] = useState<ProfileFormState>(() => profileToForm(initialProfile));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSaveProfile() {
    setStatus('saving');
    setErrorMessage(null);
    try {
      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(formToPatch(state)),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !data.ok) {
        setStatus('error');
        setErrorMessage(data.error ?? `Request failed (${response.status})`);
        return;
      }
      setStatus('saved');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Network error');
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch('/api/auth/signout', { method: 'POST' });
    } catch {
      /* even on failure we'll push to / and let middleware handle */
    }
    router.push('/');
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div>
          <p className="eyebrow">Profile</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Your athletic baseline.</h2>
          <p className="mt-2 text-sm text-muted">
            Edit any field. Save commits to your profile and the coaches see it on the next turn.
          </p>
        </div>
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
                setState((s) => ({ ...s, sex: e.target.value as ProfileFormState['sex'] }))
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
            />
          </label>
          <label>
            <span className={labelClass}>Experience level</span>
            <select
              className={inputClass}
              value={state.experienceLevel}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  experienceLevel: e.target.value as ProfileFormState['experienceLevel'],
                }))
              }
            >
              <option value="">Pick one</option>
              <option value="beginner">Beginner</option>
              <option value="building">Building</option>
              <option value="experienced">Experienced</option>
            </select>
          </label>
          <label>
            <span className={labelClass}>Weekly hours baseline</span>
            <input
              type="number"
              min="0"
              step="0.5"
              className={inputClass}
              value={state.weeklyTrainingHoursBaseline}
              onChange={(e) =>
                setState((s) => ({ ...s, weeklyTrainingHoursBaseline: e.target.value }))
              }
            />
          </label>
          <label className="md:col-span-2">
            <span className={labelClass}>Primary goal</span>
            <textarea
              rows={3}
              className={inputClass}
              value={state.primaryGoal}
              onChange={(e) => setState((s) => ({ ...s, primaryGoal: e.target.value }))}
            />
          </label>
          <label className="md:col-span-2">
            <span className={labelClass}>Health notes</span>
            <textarea
              rows={3}
              className={inputClass}
              value={state.healthNotes}
              onChange={(e) => setState((s) => ({ ...s, healthNotes: e.target.value }))}
            />
          </label>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {status === 'saving'
              ? 'Saving…'
              : status === 'saved'
              ? 'Saved.'
              : status === 'error'
              ? errorMessage
              : `Signed in as ${email}`}
          </span>
          <button
            type="button"
            onClick={handleSaveProfile}
            disabled={status === 'saving'}
            className="rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            Save profile
          </button>
        </div>
      </Card>

      <Card className="space-y-3">
        <div>
          <p className="eyebrow">What your coaches remember about you</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Coach memory · two souls.</h2>
          <p className="mt-2 text-sm text-muted">
            These are the durable notes each coach uses to frame every reply. You can read them, edit them directly, or let the coach update its training soul through chat. Click to expand.
          </p>
        </div>
        <SoulSection
          kind="training"
          title="Training soul"
          description="Read + written by the Training Coach. Preferences, recurring patterns, hard constraints."
          initial={initialTrainingSoul}
        />
        <SoulSection
          kind="longevity"
          title="Longevity soul"
          description="Read by the Longevity Guru. Doctor / influencer preferences (e.g. Attia, Saladino), dietary philosophy, chronic-condition framing."
          initial={initialLongevitySoul}
        />
      </Card>

      <Card className="space-y-3">
        <div>
          <p className="eyebrow">Account actions</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Sign out</h2>
          <p className="mt-2 text-sm text-muted">
            Clears your session cookies. You&apos;ll be sent back to the landing page.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="self-start rounded-full border border-white/15 px-4 py-2 text-sm text-white hover:border-amber-300/60 disabled:opacity-50"
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </Card>
    </div>
  );
}
