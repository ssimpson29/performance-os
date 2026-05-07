export type WeeklyStructureSession = {
  day: string;
  runSession: string;
  details: string;
  strengthMobility: string;
  exactWork: string;
};

export type PhaseWeekTarget = {
  weekLabel: string;
  mileageTarget: string;
  vertTarget: string;
  saturdayTarget?: string;
  sundayTarget?: string;
  thursdayTarget?: string;
  fuelTarget?: string;
  notes?: string;
  keyFocus?: string;
  isDeload: boolean;
  metadata: Record<string, string>;
};

export type PhaseBlock = {
  phaseName: string;
  headers: string[];
  weeks: PhaseWeekTarget[];
};

export type SupportTemplateItem = {
  label: string;
  prescription?: string;
  focus?: string;
  notes?: string;
  metadata: Record<string, string>;
};

export type SupportTemplate = {
  name: string;
  sourceSheet: string;
  items: SupportTemplateItem[];
};

export type ParsedTrainingPlan = {
  planName: string;
  sourceFileName: string;
  sheetNames: string[];
  weeklyStructure: WeeklyStructureSession[];
  phaseBlocks: PhaseBlock[];
  supportTemplates: SupportTemplate[];
};

export type ExpandedTrainingSession = {
  sessionDate: string;
  phaseName: string;
  weekLabel: string;
  weekIndex: number;
  day: string;
  title: string;
  details: string;
  strengthMobility: string;
  exactWork: string;
  weeklyFocus?: string;
  fuelTarget?: string;
  weekNotes?: string;
  isDeload: boolean;
  metadata: Record<string, string>;
};

export type ExpandedTrainingPlanCalendar = {
  planStartDate: string;
  totalWeeks: number;
  sessions: ExpandedTrainingSession[];
};

export type CompletedWorkout = {
  day: string;
  durationMinutes: number;
  intensityScore: number;
  loadScore: number;
  sessionType: string;
};

export type AdaptationAction = 'keep' | 'downgrade' | 'defer-intensity';
export type FatigueState = 'manageable' | 'elevated' | 'high';

export type AdaptedRecommendation = {
  day: string;
  baseSessionType: string;
  recommendedSessionType: string;
  action: AdaptationAction;
  reason: string;
};

export type AdaptiveCoachInput = {
  weeklyStructure: WeeklyStructureSession[];
  completedWorkouts: CompletedWorkout[];
  currentDay: string;
  recoveryScore?: number;
};

export type AdaptiveCoachResult = {
  fatigueState: FatigueState;
  overloadScore: number;
  recommendations: AdaptedRecommendation[];
};

export type WorkoutSource = 'apple_health' | 'apple_watch' | 'manual' | 'training_plan';

export type ActualWorkoutInput = {
  externalId?: string;
  source: WorkoutSource;
  workoutType: string;
  startedAt: string;
  endedAt?: string;
  localDate?: string;
  durationSeconds?: number;
  distanceMeters?: number;
  energyKcal?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgPowerWatts?: number;
  avgCadence?: number;
  perceivedExertion?: number;
  metadata?: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
};

export type NormalizedActualWorkout = {
  externalId: string;
  source: WorkoutSource;
  workoutType: string;
  startedAt: string;
  endedAt?: string;
  localDate: string;
  durationSeconds?: number;
  distanceMeters?: number;
  energyKcal?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgPowerWatts?: number;
  avgCadence?: number;
  perceivedExertion?: number;
  metadata: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
};

export type PlannedSessionForMatching = {
  id: string;
  sessionDate: string;
  title: string;
  discipline: string;
  durationMinutes?: number | null;
  objective?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ActualWorkoutForMatching = {
  id: string;
  externalId: string;
  source: WorkoutSource;
  workoutType: string;
  startedAt: string;
  localDate: string;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type MatchStatus = 'completed' | 'partial' | 'missed' | 'substituted';

export type PlanWorkoutMatch = {
  plannedSessionId: string;
  workoutId?: string;
  status: MatchStatus;
  confidence: number;
  reasoning: string;
};

export type PlanWorkoutMatchSummary = {
  matches: PlanWorkoutMatch[];
  unmatchedWorkoutIds: string[];
};
