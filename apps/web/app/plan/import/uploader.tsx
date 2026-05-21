'use client';

import { useState } from 'react';

type ApiResponse = {
  parsedSummary?: {
    planName: string;
    weeklyStructureCount: number;
    phaseBlockCount: number;
    supportTemplateCount: number;
    expandedWeekCount: number;
    expandedSessionCount: number;
  };
  persisted?: { planId: string; importedSessions: number; totalWeeks: number };
  error?: string;
};

export function TrainingPlanUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [startDate, setStartDate] = useState('');
  const [raceName, setRaceName] = useState('');
  const [raceDate, setRaceDate] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [elevationGainM, setElevationGainM] = useState('');
  const [goal, setGoal] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'idle' | 'uploading' | 'error' | 'done'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || status === 'uploading') return;
    setStatus('uploading');
    setErrorMessage(null);
    setResult(null);

    const formData = new FormData();
    formData.set('file', file);
    if (startDate) formData.set('startDate', startDate);
    if (raceName || raceDate || distanceKm || elevationGainM || goal || notes) {
      const raceContext: Record<string, unknown> = {};
      if (raceName) raceContext.raceName = raceName;
      if (raceDate) raceContext.raceDate = raceDate;
      if (distanceKm) raceContext.distanceKm = Number(distanceKm);
      if (elevationGainM) raceContext.elevationGainM = Number(elevationGainM);
      if (goal) raceContext.goal = goal;
      if (notes) raceContext.notes = notes;
      formData.set('raceContext', JSON.stringify(raceContext));
    }

    try {
      const response = await fetch('/api/imports/training-plan', {
        method: 'POST',
        body: formData,
      });
      const data = (await response.json()) as ApiResponse;
      if (!response.ok) {
        setStatus('error');
        setErrorMessage(data?.error ?? `Upload failed (${response.status})`);
        return;
      }
      setStatus('done');
      setResult(data);
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Network error');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 space-y-3">
        <label className="block">
          <span className="block text-xs uppercase tracking-[0.18em] text-brand2">Training plan workbook</span>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={status === 'uploading'}
            className="mt-2 block w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-brand2 file:px-4 file:py-2 file:text-sm file:font-medium file:text-black"
          />
          <span className="mt-1 block text-xs text-muted">Excel workbook with Weekly Schedule, phase blocks, and support templates.</span>
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-[0.18em] text-brand2">Plan start date (optional)</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={status === 'uploading'}
            className="mt-2 block w-full rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-sm text-white"
          />
        </label>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 space-y-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-brand2">Race context (optional but recommended)</p>
          <p className="mt-1 text-xs text-muted">
            Needed for race-aware adaptation. End date sets <code>training_plans.end_date</code>; goal informs the coach&apos;s adapt-up decisions.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="block text-xs text-muted">Race name</span>
            <input
              type="text"
              value={raceName}
              onChange={(e) => setRaceName(e.target.value)}
              placeholder="Swiss Alps 100"
              disabled={status === 'uploading'}
              className="mt-1 block w-full rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-sm text-white"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted">Race date</span>
            <input
              type="date"
              value={raceDate}
              onChange={(e) => setRaceDate(e.target.value)}
              disabled={status === 'uploading'}
              className="mt-1 block w-full rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-sm text-white"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted">Distance (km)</span>
            <input
              type="number"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
              placeholder="160"
              disabled={status === 'uploading'}
              className="mt-1 block w-full rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-sm text-white"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted">Elevation gain (m)</span>
            <input
              type="number"
              value={elevationGainM}
              onChange={(e) => setElevationGainM(e.target.value)}
              placeholder="9000"
              disabled={status === 'uploading'}
              className="mt-1 block w-full rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-sm text-white"
            />
          </label>
        </div>
        <label className="block">
          <span className="block text-xs text-muted">Goal</span>
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Place as high as possible (target top 10)"
            disabled={status === 'uploading'}
            className="mt-1 block w-full rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-sm text-white"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-muted">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="A-race for 2026 season."
            disabled={status === 'uploading'}
            className="mt-1 block w-full rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-sm text-white"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">
          {status === 'uploading' ? 'Uploading + parsing…' : 'File parses on the server before any data is persisted.'}
        </span>
        <button
          type="submit"
          disabled={!file || status === 'uploading'}
          className="rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {status === 'uploading' ? 'Importing…' : 'Import plan'}
        </button>
      </div>

      {errorMessage ? (
        <div className="rounded-2xl border border-red-400/40 bg-red-500/[0.08] p-4">
          <p className="text-sm text-red-300">{errorMessage}</p>
        </div>
      ) : null}

      {result?.parsedSummary && status === 'done' ? (
        <div className="rounded-2xl border border-green-400/30 bg-green-500/[0.06] p-4 space-y-2">
          <p className="text-sm font-medium text-white">Imported: {result.parsedSummary.planName}</p>
          <p className="text-xs text-muted">
            {result.parsedSummary.phaseBlockCount} phases · {result.parsedSummary.weeklyStructureCount} weekly anchor sessions ·
            {' '}{result.parsedSummary.expandedWeekCount} weeks expanded · {result.parsedSummary.expandedSessionCount} planned sessions
          </p>
          {result.persisted ? (
            <p className="text-xs text-muted">
              Persisted plan id <code className="text-brand2">{result.persisted.planId}</code> with {result.persisted.importedSessions} sessions.
            </p>
          ) : null}
          <a href="/coach" className="inline-flex items-center self-start rounded-full bg-brand2 px-4 py-1.5 text-xs font-medium text-black">
            Talk to your coach →
          </a>
        </div>
      ) : null}
    </form>
  );
}
