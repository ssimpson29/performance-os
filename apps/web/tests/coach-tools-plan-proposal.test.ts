import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AthleteContext } from '../lib/agents/athlete-context';

// Mock the deterministic generator + persistence so we test wiring, not plan
// math. vi.hoisted lets the (hoisted) vi.mock factories reference these fns.
const { proposeRacePlan, commitProposedPlan } = vi.hoisted(() => ({
  proposeRacePlan: vi.fn(),
  commitProposedPlan: vi.fn(),
}));
vi.mock('../lib/agents/plan-generator', () => ({ proposeRacePlan, commitProposedPlan }));

// Mock the durable store so we can assert the handlers call it and simulate a
// cross-request commit (new request → empty in-memory map → durable load hit).
const { savePlanProposal, loadPlanProposal, clearPlanProposal } = vi.hoisted(() => ({
  savePlanProposal: vi.fn(),
  loadPlanProposal: vi.fn(),
  clearPlanProposal: vi.fn(),
}));
vi.mock('../lib/agents/plan-proposal-store', () => ({ savePlanProposal, loadPlanProposal, clearPlanProposal }));

import { createProposalStore, executeCoachTool } from '../lib/agents/coach-tools';

function makeCtx(overrides: Partial<AthleteContext> = {}): AthleteContext {
  return {
    userId: 'user-1',
    today: '2026-05-29',
    profile: null,
    currentPlan: null,
    recentWorkouts: [],
    recoveryHistory: [],
    injuryHistory: [],
    biomarkers: null,
    longevityContext: null,
    conversation: [],
    followUp: null,
    longevityConversation: [],
    trainingSoul: null,
    longevitySoul: null,
    ...overrides,
  } as unknown as AthleteContext;
}

const stubSupabase = { marker: 'supabase' } as never;
const fakeProposal = { summary: 'SA100 plan', raceContext: { raceDate: '2026-08-07', goal: 'finish' }, plan: {} };

describe('proposeRacePlan handler — durability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proposeRacePlan.mockReturnValue(fakeProposal);
  });

  it('persists the draft to the durable store as well as the in-memory map', async () => {
    const proposalStore = createProposalStore();
    const args = JSON.stringify({ raceName: 'Swiss Alps 100', raceDate: '2026-08-07' });
    const result = await executeCoachTool('proposeRacePlan', args, { ctx: makeCtx(), supabase: stubSupabase, proposalStore });

    const parsed = JSON.parse(result);
    expect(parsed.proposalId).toMatch(/^proposal-/);
    expect(proposalStore.size).toBe(1);
    expect(savePlanProposal).toHaveBeenCalledTimes(1);
    const call = savePlanProposal.mock.calls[0][1];
    expect(call.userId).toBe('user-1');
    expect(call.today).toBe('2026-05-29');
    expect(call.proposalId).toBe(parsed.proposalId);
    expect(call.proposal).toBe(fakeProposal);
  });
});

describe('commitTrainingPlan handler — cross-request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commitProposedPlan.mockResolvedValue({ planId: 'plan-1', importedSessions: 84, totalWeeks: 12 });
  });

  it('commits using the durable store when the in-memory map is empty (next-request approval)', async () => {
    // Simulate: athlete approves in a NEW request, so the map is fresh/empty,
    // but the draft was persisted on the propose turn.
    loadPlanProposal.mockResolvedValue({ proposalId: 'proposal-abc', proposal: fakeProposal, proposedAt: '', day: '2026-05-29' });

    const args = JSON.stringify({ proposalId: 'proposal-abc' });
    const result = await executeCoachTool('commitTrainingPlan', args, {
      ctx: makeCtx(),
      supabase: stubSupabase,
      proposalStore: createProposalStore(), // empty — new request
    });

    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.planId).toBe('plan-1');
    expect(loadPlanProposal).toHaveBeenCalledWith(stubSupabase, { userId: 'user-1' });
    expect(commitProposedPlan).toHaveBeenCalledTimes(1);
    expect(commitProposedPlan.mock.calls[0][1].proposal).toBe(fakeProposal);
    // Draft consumed so a repeated "commit it" can't duplicate the plan.
    expect(clearPlanProposal).toHaveBeenCalledWith(stubSupabase, { userId: 'user-1', day: '2026-05-29' });
  });

  it('uses the in-memory map without hitting the durable store on a same-run commit', async () => {
    const proposalStore = createProposalStore();
    // Seed the map as proposeRacePlan would have, within the same run.
    proposeRacePlan.mockReturnValue(fakeProposal);
    const proposeResult = JSON.parse(
      await executeCoachTool('proposeRacePlan', JSON.stringify({ raceName: 'SA100', raceDate: '2026-08-07' }), {
        ctx: makeCtx(),
        supabase: stubSupabase,
        proposalStore,
      }),
    );
    vi.clearAllMocks();
    commitProposedPlan.mockResolvedValue({ planId: 'plan-1', importedSessions: 84, totalWeeks: 12 });

    const result = await executeCoachTool('commitTrainingPlan', JSON.stringify({ proposalId: proposeResult.proposalId }), {
      ctx: makeCtx(),
      supabase: stubSupabase,
      proposalStore,
    });

    expect(JSON.parse(result).ok).toBe(true);
    expect(loadPlanProposal).not.toHaveBeenCalled();
    expect(clearPlanProposal).toHaveBeenCalledTimes(1); // still cleared (day undefined)
  });

  it('errors when neither the map nor the durable store has a proposal', async () => {
    loadPlanProposal.mockResolvedValue(null);

    const result = await executeCoachTool('commitTrainingPlan', JSON.stringify({ proposalId: 'gone' }), {
      ctx: makeCtx(),
      supabase: stubSupabase,
      proposalStore: createProposalStore(),
    });

    const parsed = JSON.parse(result);
    expect(parsed.error).toMatch(/No proposal found/);
    expect(commitProposedPlan).not.toHaveBeenCalled();
  });
});
