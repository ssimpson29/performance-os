'use client';

import { useState } from 'react';

type ExtractMarker = {
  rawName: string;
  value: number;
  unit: string;
  referenceRange?: string;
  markerKey: string | null;
  displayName: string | null;
  canonicalUnit: string | null;
  unitMatchesCanonical: boolean;
  inCatalog: boolean;
};

type ExtractResponse = {
  panelDate: string | null;
  provider: string | null;
  panelName: string | null;
  markers: ExtractMarker[];
  warnings: string[];
  llmInvoked?: boolean;
  error?: string;
};

type ReviewRow = ExtractMarker & {
  include: boolean;
};

export function PanelImageUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [extractStatus, setExtractStatus] = useState<'idle' | 'extracting' | 'error'>('idle');
  const [extractError, setExtractError] = useState<string | null>(null);

  const [panelDate, setPanelDate] = useState('');
  const [provider, setProvider] = useState('');
  const [panelName, setPanelName] = useState('');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'error' | 'done'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedPanelId, setSavedPanelId] = useState<string | null>(null);

  async function handleExtract(event: React.FormEvent) {
    event.preventDefault();
    if (!file || extractStatus === 'extracting') return;
    setExtractStatus('extracting');
    setExtractError(null);
    setSaveStatus('idle');
    setSaveError(null);
    setSavedPanelId(null);

    const formData = new FormData();
    formData.set('image', file);

    try {
      const response = await fetch('/api/imports/biomarker-panel-image', {
        method: 'POST',
        body: formData,
      });
      const data = (await response.json()) as ExtractResponse;
      if (!response.ok) {
        setExtractStatus('error');
        setExtractError(data?.error ?? `Extraction failed (${response.status})`);
        return;
      }
      setPanelDate(data.panelDate ?? '');
      setProvider(data.provider ?? '');
      setPanelName(data.panelName ?? '');
      setWarnings(data.warnings ?? []);
      setRows(
        (data.markers ?? []).map((m) => ({
          ...m,
          include: m.inCatalog && m.unitMatchesCanonical,
        })),
      );
      setExtractStatus('idle');
    } catch (err) {
      setExtractStatus('error');
      setExtractError(err instanceof Error ? err.message : 'Network error');
    }
  }

  function updateRow(index: number, updates: Partial<ReviewRow>) {
    setRows((prior) => {
      const next = [...prior];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }

  async function handleSave() {
    if (saveStatus === 'saving') return;
    const included = rows.filter((r) => r.include);
    if (!panelDate) {
      setSaveStatus('error');
      setSaveError('Set the panel date before saving.');
      return;
    }
    if (included.length === 0) {
      setSaveStatus('error');
      setSaveError('Select at least one marker to include.');
      return;
    }
    // Pre-flight validation: every included row must have markerKey + matching canonical unit.
    const invalid = included.find((r) => !r.markerKey || !r.unitMatchesCanonical);
    if (invalid) {
      setSaveStatus('error');
      setSaveError(
        `Row "${invalid.rawName}" can't be saved: ` +
          (invalid.markerKey ? `unit '${invalid.unit}' must equal catalog unit '${invalid.canonicalUnit}'.` : 'no catalog match — uncheck or remap.'),
      );
      return;
    }

    setSaveStatus('saving');
    setSaveError(null);

    const payload = {
      panelDate,
      provider: provider || undefined,
      panelName: panelName || undefined,
      markers: included.map((r) => ({ markerKey: r.markerKey, value: r.value, unit: r.unit })),
    };

    try {
      const response = await fetch('/api/imports/biomarker-panel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { panelId?: string; error?: string };
      if (!response.ok) {
        setSaveStatus('error');
        setSaveError(data?.error ?? `Save failed (${response.status})`);
        return;
      }
      setSaveStatus('done');
      setSavedPanelId(data.panelId ?? null);
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : 'Network error');
    }
  }

  const hasReviewData = rows.length > 0 || panelDate || provider || panelName;

  return (
    <div className="space-y-6">
      <form onSubmit={handleExtract} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 space-y-3">
        <label className="block">
          <span className="block text-xs uppercase tracking-[0.18em] text-brand2">Lab report image</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={extractStatus === 'extracting'}
            className="mt-2 block w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-brand2 file:px-4 file:py-2 file:text-sm file:font-medium file:text-black"
          />
          <span className="mt-1 block text-xs text-muted">JPG, PNG, WebP, or PDF. The vision LLM extracts values; you review before save.</span>
        </label>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {extractStatus === 'extracting' ? 'AI extracting…' : 'Extraction runs server-side via the configured vision model.'}
          </span>
          <button
            type="submit"
            disabled={!file || extractStatus === 'extracting'}
            className="rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            {extractStatus === 'extracting' ? 'Extracting…' : 'Extract'}
          </button>
        </div>
        {extractError ? (
          <div className="rounded-2xl border border-red-400/40 bg-red-500/[0.08] p-3">
            <p className="text-sm text-red-300">{extractError}</p>
          </div>
        ) : null}
      </form>

      {hasReviewData ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-brand2">Review extraction</p>
            <p className="mt-1 text-xs text-muted">
              Fix anything the LLM misread. Only rows with a catalog match AND the canonical unit will be saved.
            </p>
          </div>

          {warnings.length ? (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.05] p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-amber-300">Warnings</p>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="block text-xs text-muted">Panel date *</span>
              <input
                type="date"
                value={panelDate}
                onChange={(e) => setPanelDate(e.target.value)}
                className="mt-1 block w-full rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-sm text-white"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-muted">Provider</span>
              <input
                type="text"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="Quest, LabCorp…"
                className="mt-1 block w-full rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-sm text-white"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-muted">Panel name</span>
              <input
                type="text"
                value={panelName}
                onChange={(e) => setPanelName(e.target.value)}
                placeholder="Annual longevity panel"
                className="mt-1 block w-full rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-sm text-white"
              />
            </label>
          </div>

          {rows.length === 0 ? (
            <p className="text-sm italic text-muted">No markers extracted. Re-upload a clearer image or use the JSON API.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs uppercase tracking-[0.18em] text-muted">
                  <tr>
                    <th className="py-2 pr-3 text-left">Include</th>
                    <th className="py-2 pr-3 text-left">Raw name</th>
                    <th className="py-2 pr-3 text-left">Catalog match</th>
                    <th className="py-2 pr-3 text-left">Value</th>
                    <th className="py-2 pr-3 text-left">Unit</th>
                    <th className="py-2 pr-3 text-left">Canonical</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {rows.map((r, i) => {
                    const includable = r.inCatalog && r.unitMatchesCanonical;
                    return (
                      <tr key={i} className={includable ? '' : 'opacity-70'}>
                        <td className="py-2 pr-3 align-top">
                          <input
                            type="checkbox"
                            checked={r.include}
                            disabled={!includable}
                            onChange={(e) => updateRow(i, { include: e.target.checked })}
                          />
                        </td>
                        <td className="py-2 pr-3 align-top text-muted">{r.rawName}</td>
                        <td className="py-2 pr-3 align-top">
                          {r.markerKey ? (
                            <>
                              <span className="text-white">{r.displayName}</span>
                              <div className="text-xs text-muted">{r.markerKey}</div>
                            </>
                          ) : (
                            <span className="text-amber-300">No match</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 align-top">
                          <input
                            type="number"
                            step="any"
                            value={r.value}
                            onChange={(e) => updateRow(i, { value: Number(e.target.value) })}
                            className="block w-28 rounded-2xl border border-white/10 bg-white/[0.04] p-1 text-sm text-white"
                          />
                        </td>
                        <td className="py-2 pr-3 align-top">
                          <input
                            type="text"
                            value={r.unit}
                            onChange={(e) =>
                              updateRow(i, {
                                unit: e.target.value,
                                unitMatchesCanonical: r.canonicalUnit ? e.target.value === r.canonicalUnit : false,
                              })
                            }
                            className="block w-24 rounded-2xl border border-white/10 bg-white/[0.04] p-1 text-sm text-white"
                          />
                        </td>
                        <td className="py-2 pr-3 align-top text-xs text-muted">
                          {r.canonicalUnit ?? '—'}
                          {r.canonicalUnit && !r.unitMatchesCanonical ? (
                            <div className="text-amber-300">Convert to {r.canonicalUnit}</div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted">
              {rows.filter((r) => r.include).length} of {rows.length} marker(s) will be saved.
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveStatus === 'saving' || rows.length === 0}
              className="rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save panel'}
            </button>
          </div>

          {saveError ? (
            <div className="rounded-2xl border border-red-400/40 bg-red-500/[0.08] p-3">
              <p className="text-sm text-red-300">{saveError}</p>
            </div>
          ) : null}
          {saveStatus === 'done' && savedPanelId ? (
            <div className="rounded-2xl border border-green-400/30 bg-green-500/[0.06] p-3 space-y-2">
              <p className="text-sm text-white">Panel saved (<code className="text-brand2">{savedPanelId}</code>).</p>
              <a href="/longevity" className="inline-flex items-center self-start rounded-full bg-brand2 px-4 py-1.5 text-xs font-medium text-black">
                Go to Longevity →
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
