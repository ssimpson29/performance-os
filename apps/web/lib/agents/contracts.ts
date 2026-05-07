export type LlmAgentRole = 'training-coach' | 'longevity-guru';

export type TrainingCoachContext = {
  weeklyStructureSummary: string;
  currentPhase: string;
  weeklyTargets: {
    mileageTarget?: string;
    vertTarget?: string;
    fuelTarget?: string;
    weekNotes?: string;
  };
  recentCompletedWorkouts: Array<{
    day: string;
    sessionType: string;
    durationMinutes: number;
    intensityScore: number;
    loadScore: number;
  }>;
  recoverySignals?: {
    readinessScore?: number;
    sleepScore?: number;
    hrvMs?: number;
    restingHr?: number;
  };
};

export type LongevityGuruContext = {
  activeTrainingLoadSummary: string;
  biomarkers: Array<{
    biomarker: string;
    value: string;
    unit?: string;
    status?: string;
  }>;
  healthEvents: Array<{
    type: string;
    title: string;
    startedAt: string;
  }>;
  currentGoals: string[];
};

export type LlmAgentDecision = {
  role: LlmAgentRole;
  summary: string;
  recommendations: string[];
  cautions?: string[];
  confidence?: 'low' | 'medium' | 'high';
  evidence: string[];
};
