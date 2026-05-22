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

export type RaceContext = {
  raceName: string;
  raceDate: string;
  distanceKm?: number;
  elevationGainM?: number;
  goal?: string;
  notes?: string;
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
  /**
   * ISO YYYY-MM-DD of the workout's local date — lets the coach reason about
   * "yesterday" / "Thursday's run" against a real anchor. Optional so the
   * many adaptive-coach test fixtures that only carry day-of-week stay valid;
   * production `loadCompletedWorkouts` always sets it.
   */
  localDate?: string;
  /** Day-of-week derived from localDate. */
  day: string;
  durationMinutes: number;
  intensityScore: number;
  loadScore: number;
  sessionType: string;
  /** Source row (apple_health / apple_watch / strava / manual / training_plan). Lets the coach reference where the data came from. */
  source?: string;
  /** Athlete-authored description (e.g. Strava notes — "+8kg vest", "felt strong on the climb"). Null when the source didn't carry one. */
  description?: string | null;
  /** Distance in meters, if recorded. */
  distanceMeters?: number | null;
  /** Average heart rate (bpm), if recorded. */
  avgHeartRate?: number | null;
  /** Max heart rate (bpm), if recorded. */
  maxHeartRate?: number | null;
  /**
   * Total elevation gain in meters. Strava reports this on every activity;
   * we stash in workouts.metadata.strava.elevationGainM and project here.
   */
  elevationGainM?: number | null;
  /** Highest elevation reached during the workout, in meters. */
  elevHigh?: number | null;
  /** Lowest elevation reached during the workout, in meters. */
  elevLow?: number | null;
  /** Average speed in m/s. Convert to min/km via (1000 / speed) / 60. */
  avgSpeedMps?: number | null;
  /** Peak speed in m/s. */
  maxSpeedMps?: number | null;
  /**
   * Average cadence. For running from Strava this is strides/min for one
   * foot (multiply ×2 for total cadence). For cycling it's RPM.
   */
  avgCadence?: number | null;
  /** Average power in watts (cycling, or running power if device-reported). */
  avgPowerWatts?: number | null;
  /** Max power in watts. */
  maxPowerWatts?: number | null;
  /** Weighted (normalized) average power in watts. */
  weightedAvgPowerWatts?: number | null;
  /** True if power came from a real power meter, false when estimated. */
  devicePowerMeter?: boolean | null;
  /** Athlete-reported RPE 1-10 (Strava lets athletes log this directly). */
  perceivedExertion?: number | null;
  /** Strava's Relative Effort 0-300+. Best single-number intensity proxy. */
  sufferScore?: number | null;
  /** Energy burned in kcal. */
  energyKcal?: number | null;
  /** Average temperature in °C, if the device recorded it. */
  avgTempC?: number | null;
  /** Strava gear id (shoe / bike) — useful for tracking shoe mileage. */
  gearId?: string | null;
  /** Name of the recording device (e.g. "Apple Watch", "Garmin Forerunner 965"). */
  deviceName?: string | null;
  /** True if the workout was on a treadmill/trainer rather than outdoor. */
  trainer?: boolean | null;
  /** Strava-side activity title (e.g. "Morning Run", "Long Hill Day"). */
  activityName?: string | null;
  /**
   * Strava's classification of the run: 0=default, 1=race, 2=long run, 3=workout.
   * Distinct from `sessionType` (which is sport_type like "Run", "TrailRun").
   */
  stravaWorkoutType?: number | null;
};

export type AdaptationAction = 'keep' | 'downgrade' | 'defer-intensity' | 'raise';
export type FatigueState = 'manageable' | 'elevated' | 'high';

export type AdaptedRecommendation = {
  day: string;
  baseSessionType: string;
  recommendedSessionType: string;
  action: AdaptationAction;
  reason: string;
};

export type RecoverySample = {
  date: string;
  score: number;
};

export type PrescribedWeek = {
  /** Total prescribed running volume for the rolling week (any consistent unit). */
  volumeTarget?: number;
  /** Mean prescribed session intensity for the rolling week (1-10 RPE-equivalent). */
  intensityTarget?: number;
};

export type AdaptiveCoachInput = {
  weeklyStructure: WeeklyStructureSession[];
  completedWorkouts: CompletedWorkout[];
  currentDay: string;
  recoveryScore?: number;

  /** ISO date (YYYY-MM-DD) representing "today". Required for race-aware adaptation. */
  today?: string;
  /** ISO race date from training_plans.end_date. */
  raceDate?: string;
  /** ISO plan start date (first Monday of week 1). */
  planStartDate?: string;
  /** Phase blocks from training_plans.metadata.phaseBlocks. */
  phaseBlocks?: PhaseBlock[];
  /** Rolling-window prescribed targets used for adapt-up / adapt-down delta. */
  prescribedWeek?: PrescribedWeek;
  /** Recent recovery samples (e.g. Oura) used for trend detection. */
  recoveryHistory?: RecoverySample[];
  /** Athlete's plan goal (free text). Used by the LLM layer; deterministic core only reads structure. */
  goal?: string;
  /** Structured race context from training_plans.metadata.raceContext. */
  raceContext?: RaceContext;
  /**
   * Cross-write from the Longevity Guru, read out of
   * daily_summaries.summary.longevityContext. When recoveryPriority is
   * 'elevated', the engine suppresses adapt-up, biases toward 'lower',
   * and defers Tuesday quality regardless of weekend overload.
   * Structurally compatible with LongevityContext in lib/agents/longevity-guru.ts.
   */
  longevityContext?: {
    recoveryPriority: 'low' | 'normal' | 'elevated';
    notes?: string;
    evaluatedAt?: string;
  };
};

export type PhasePosition = {
  /** Name of the phase the athlete is currently in, or null if outside any phase block. */
  phaseName: string | null;
  /** 0-indexed position of the current phase in phaseBlocks. */
  phaseIndex: number;
  /** 0-indexed week within the current phase. */
  weekIndexInPhase: number;
  /** 0-indexed total week from plan start. */
  totalWeekIndex: number;
  /** Whole calendar weeks remaining until raceDate (>= 0; 0 on race week). */
  weeksToRace: number;
  /** True when today's week contains the race date. */
  isRaceWeek: boolean;
  /** True when the current phase name contains "Taper" (case-insensitive). */
  isTaper: boolean;
  /** Convenience: whether raising load is permitted in the current phase. */
  raiseAllowed: boolean;
};

export type RecoveryTrendDirection = 'improving' | 'stable' | 'degrading';

export type RecoveryTrend = {
  direction: RecoveryTrendDirection;
  /** 0..1 confidence based on sample count, time span, and signal-to-noise. */
  confidence: number;
  sampleCount: number;
};

export type PerformanceSignal = 'over' | 'on' | 'under';

export type PerformanceDelta = {
  /** (completedVolume - prescribedVolume) / prescribedVolume, or null when no prescription. */
  volumeDelta: number | null;
  /** (completedIntensity - prescribedIntensity) / prescribedIntensity, or null when no prescription. */
  intensityDelta: number | null;
  signal: PerformanceSignal;
};

export type PlanAdaptationSuggestion = 'raise' | 'hold' | 'lower';

export type PlanAdaptation = {
  /** Block-level suggestion for the next phase week, distinct from per-day recommendations. */
  suggestion: PlanAdaptationSuggestion;
  /** Proposed percentage change to next block's volume/intensity targets (positive for raise, negative for lower). */
  magnitudePct: number;
  reason: string;
};

export type AdaptiveCoachResult = {
  fatigueState: FatigueState;
  overloadScore: number;
  recommendations: AdaptedRecommendation[];
  /** Present when raceDate + planStartDate + phaseBlocks are supplied. */
  phasePosition?: PhasePosition;
  /** Present when recoveryHistory is supplied. */
  recoveryTrend?: RecoveryTrend;
  /** Present when prescribedWeek is supplied. */
  performanceDelta?: PerformanceDelta;
  /** Block-level adapt-up / adapt-down suggestion, distinct from per-day recommendations. */
  planAdaptation?: PlanAdaptation;
};

export type WorkoutSource = 'apple_health' | 'apple_watch' | 'manual' | 'training_plan' | 'strava';

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
