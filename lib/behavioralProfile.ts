import type { RawVector } from '../app/demo/biometrics';

export const BEHAVIOR_FEATURES = [
  'avgHoldTime',
  'medianHoldTime',
  'holdTimeP90',
  'holdTimeMad',
  'avgFlightTime',
  'medianFlightTime',
  'flightTimeP90',
  'flightTimeMad',
  'wpm',
  'holdTimeVariance',
  'flightTimeVariance',
  'digraphTiming',
  'trigraphTiming',
  'pauseRate',
  'burstLength',
  'avgCursorVelocity',
  'avgCursorAcceleration',
  'movementSmoothness',
  'directionChanges',
  'clickInterval',
  'interactionInterval',
  'idleRatio',
  'focusTransitions',
] as const;

export type BehaviorFeature = (typeof BEHAVIOR_FEATURES)[number];
export type BehaviorFeatures = Partial<Record<BehaviorFeature, number>>;
export type DeviceContext = 'pointer' | 'touch' | 'unknown';
export type ProfileMaturity = 'immature' | 'developing' | 'mature';
export type ProfileReliability = 'limited' | 'usable' | 'unreliable';

export interface BehaviorObservation {
  features: BehaviorFeatures;
  deviceContext: DeviceContext;
  observedKeys: number;
  featureCoverage: number;
  capturedAt: string;
}

function isValidLegacyVector(value: unknown): value is RawVector {
  if (!value || typeof value !== 'object') return false;
  const vector = value as Record<string, unknown>;
  return ['avgHoldTime', 'avgFlightTime', 'wpm', 'holdTimeVariance', 'flightTimeVariance']
    .every((key) => typeof vector[key] === 'number' && Number.isFinite(vector[key]) &&
      (vector[key] as number) >= 0 && (vector[key] as number) <= 10_000) &&
    (vector.avgHoldTime as number) > 0 &&
    (vector.avgFlightTime as number) > 0 &&
    (vector.wpm as number) > 0;
}

export interface FeatureDistribution {
  count: number;
  missingCount: number;
  mean: number;
  median: number;
  standardDeviation: number;
  medianAbsoluteDeviation: number;
  q10: number;
  q90: number;
  reliability: 'limited' | 'variable' | 'stable';
}

export interface ProfileUpdate {
  revision: number;
  at: string;
  outcome: 'initialized' | 'accepted' | 'quarantined';
  reason: string;
  clippedFeatures: BehaviorFeature[];
}

export interface BehavioralProfile {
  schemaVersion: 1;
  revision: number;
  createdAt: string;
  updatedAt: string;
  acceptedSessions: number;
  quarantinedSessions: number;
  maturity: ProfileMaturity;
  reliability: ProfileReliability;
  sessionDiversity: {
    distinctDeviceContexts: number;
    deviceContextCounts: Record<DeviceContext, number>;
  };
  signalCoverage: Record<'keystroke' | 'mouse' | 'interaction', number>;
  missingModalities: string[];
  stableTraits: Partial<Record<BehaviorFeature, FeatureDistribution>>;
  recentState: BehaviorFeatures;
  contextualTraits: Partial<Record<DeviceContext, Partial<Record<BehaviorFeature, FeatureDistribution>>>>;
  updateHistory: ProfileUpdate[];
  observations: BehaviorObservation[];
}

export interface CursorSample {
  at: number;
  x: number;
  y: number;
}

export interface BehaviorSamples {
  holdTimes: number[];
  flightTimes: number[];
  elapsedMs: number;
  characterCount: number;
  cursorSamples: CursorSample[];
  clickTimes: number[];
  interactionTimes: number[];
  idleMs: number;
  focusTransitions: number;
  deviceContext: DeviceContext;
}

export interface ProfileComparison {
  similarity: number | null;
  comparableFeatures: number;
  contextualBaselineUsed: boolean;
  deviations: Array<{
    feature: BehaviorFeature;
    observed: number;
    expectedMedian: number;
    expectedVariability: number;
    normalizedDeviation: number;
  }>;
}

const FEATURE_FLOORS: Record<BehaviorFeature, number> = {
  avgHoldTime: 15,
  medianHoldTime: 15,
  holdTimeP90: 20,
  holdTimeMad: 10,
  avgFlightTime: 20,
  medianFlightTime: 20,
  flightTimeP90: 30,
  flightTimeMad: 15,
  wpm: 5,
  holdTimeVariance: 10,
  flightTimeVariance: 15,
  digraphTiming: 35,
  trigraphTiming: 50,
  pauseRate: 0.08,
  burstLength: 1,
  avgCursorVelocity: 0.1,
  avgCursorAcceleration: 0.1,
  movementSmoothness: 0.1,
  directionChanges: 2,
  clickInterval: 100,
  interactionInterval: 100,
  idleRatio: 0.05,
  focusTransitions: 1,
};
const FEATURE_MAXIMUMS: Record<BehaviorFeature, number> = {
  avgHoldTime: 5000,
  medianHoldTime: 5000,
  holdTimeP90: 5000,
  holdTimeMad: 5000,
  avgFlightTime: 10000,
  medianFlightTime: 10000,
  flightTimeP90: 10000,
  flightTimeMad: 10000,
  wpm: 1000,
  holdTimeVariance: 5000,
  flightTimeVariance: 10000,
  digraphTiming: 20000,
  trigraphTiming: 30000,
  pauseRate: 1,
  burstLength: 10000,
  avgCursorVelocity: 10000,
  avgCursorAcceleration: 100000,
  movementSmoothness: 1,
  directionChanges: 1,
  clickInterval: 60000,
  interactionInterval: 60000,
  idleRatio: 1,
  focusTransitions: 1000,
};

const KEYSTROKE_FEATURES: BehaviorFeature[] = [
  'avgHoldTime', 'medianHoldTime', 'holdTimeP90', 'holdTimeMad',
  'avgFlightTime', 'medianFlightTime', 'flightTimeP90', 'flightTimeMad',
  'wpm', 'holdTimeVariance', 'flightTimeVariance', 'digraphTiming',
  'trigraphTiming', 'pauseRate', 'burstLength',
];
const MOUSE_FEATURES: BehaviorFeature[] = [
  'avgCursorVelocity', 'avgCursorAcceleration', 'movementSmoothness',
  'directionChanges', 'clickInterval',
];
const INTERACTION_FEATURES: BehaviorFeature[] = [
  'interactionInterval', 'idleRatio', 'focusTransitions',
];

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function validSamples(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value) && value >= 0 && value <= 60_000);
}

function averageWindowSum(values: number[], width: number): number | undefined {
  if (values.length < width) return undefined;
  const sums: number[] = [];
  for (let index = 0; index <= values.length - width; index += 1) {
    sums.push(values.slice(index, index + width).reduce((sum, value) => sum + value, 0));
  }
  return mean(sums);
}

export function deriveBehaviorObservation(samples: BehaviorSamples): BehaviorObservation {
  const holds = validSamples(samples.holdTimes);
  const flights = validSamples(samples.flightTimes);
  const features: BehaviorFeatures = {};
  const capture = (name: BehaviorFeature, value: number | undefined) => {
    if (value !== undefined && Number.isFinite(value)) features[name] = value;
  };
  const holdMedian = median(holds);
  const flightMedian = median(flights);
  const holdDeviations = holds.map((value) => Math.abs(value - holdMedian));
  const flightDeviations = flights.map((value) => Math.abs(value - flightMedian));
  const minutes = samples.elapsedMs > 0 ? samples.elapsedMs / 60_000 : 0;
  capture('avgHoldTime', holds.length ? mean(holds) : undefined);
  capture('medianHoldTime', holds.length ? holdMedian : undefined);
  capture('holdTimeP90', holds.length ? quantile(holds, 0.9) : undefined);
  capture('holdTimeMad', holds.length ? median(holdDeviations) : undefined);
  capture('avgFlightTime', flights.length ? mean(flights) : undefined);
  capture('medianFlightTime', flights.length ? flightMedian : undefined);
  capture('flightTimeP90', flights.length ? quantile(flights, 0.9) : undefined);
  capture('flightTimeMad', flights.length ? median(flightDeviations) : undefined);
  capture('wpm', minutes > 0 ? samples.characterCount / 5 / minutes : undefined);
  capture('holdTimeVariance', holds.length > 1 ? standardDeviation(holds) : undefined);
  capture('flightTimeVariance', flights.length > 1 ? standardDeviation(flights) : undefined);
  capture('digraphTiming', averageWindowSum(flights, 2));
  capture('trigraphTiming', averageWindowSum(flights, 3));
  capture('pauseRate', flights.length ? flights.filter((value) => value >= 1000).length / flights.length : undefined);
  const burstIntervals = flights.filter((value) => value < 500);
  capture('burstLength', flights.length ? burstIntervals.length / Math.max(1, flights.filter((value) => value >= 500).length + 1) : undefined);

  const cursors = samples.cursorSamples
    .filter((point) => Number.isFinite(point.at) && Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.at - b.at);
  const velocities: number[] = [];
  const directions: number[] = [];
  for (let index = 1; index < cursors.length; index += 1) {
    const previous = cursors[index - 1];
    const current = cursors[index];
    const duration = current.at - previous.at;
    if (duration <= 0 || duration > 1000) continue;
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    velocities.push(Math.hypot(dx, dy) / duration);
    directions.push(Math.atan2(dy, dx));
  }
  const accelerations = velocities.slice(1).map((velocity, index) => {
    const duration = cursors[index + 2].at - cursors[index + 1].at;
    return duration > 0 ? Math.abs(velocity - velocities[index]) / duration : 0;
  });
  let directionChanges = 0;
  for (let index = 1; index < directions.length; index += 1) {
    let delta = Math.abs(directions[index] - directions[index - 1]);
    if (delta > Math.PI) delta = 2 * Math.PI - delta;
    if (delta > Math.PI / 4) directionChanges += 1;
  }
  capture('avgCursorVelocity', velocities.length ? mean(velocities) : undefined);
  capture('avgCursorAcceleration', accelerations.length ? mean(accelerations) : undefined);
  capture('movementSmoothness', directions.length > 1 ? 1 - directionChanges / (directions.length - 1) : undefined);
  capture('directionChanges', directions.length > 1 ? directionChanges / (directions.length - 1) : undefined);

  const intervals = (times: number[]) => {
    const ordered = times.filter((time) => Number.isFinite(time) && time >= 0).sort((a, b) => a - b);
    return ordered.slice(1).map((time, index) => time - ordered[index]).filter((duration) => duration > 0 && duration <= 60_000);
  };
  const clickIntervals = intervals(samples.clickTimes);
  const interactionIntervals = intervals(samples.interactionTimes);
  capture('clickInterval', clickIntervals.length ? mean(clickIntervals) : undefined);
  capture('interactionInterval', interactionIntervals.length ? mean(interactionIntervals) : undefined);
  capture('idleRatio', samples.elapsedMs > 0 ? Math.min(1, Math.max(0, samples.idleMs / samples.elapsedMs)) : undefined);
  capture('focusTransitions', samples.focusTransitions > 0 ? samples.focusTransitions : undefined);

  const present = Object.keys(features).length;
  return {
    features,
    deviceContext: samples.deviceContext,
    observedKeys: holds.length,
    featureCoverage: present / BEHAVIOR_FEATURES.length,
    capturedAt: new Date().toISOString(),
  };
}

export function observationFromRawVector(vector: RawVector, deviceContext: DeviceContext = 'unknown'): BehaviorObservation {
  if (!isValidLegacyVector(vector)) throw new Error('Cannot create a profile observation from an invalid timing vector.');
  const features: BehaviorFeatures = {
    avgHoldTime: vector.avgHoldTime,
    avgFlightTime: vector.avgFlightTime,
    wpm: vector.wpm,
    holdTimeVariance: vector.holdTimeVariance,
    flightTimeVariance: vector.flightTimeVariance,
  };
  return {
    features,
    deviceContext,
    observedKeys: 0,
    featureCoverage: Object.keys(features).length / BEHAVIOR_FEATURES.length,
    capturedAt: new Date().toISOString(),
  };
}

export function validateBehaviorObservation(value: unknown): value is BehaviorObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const observation = value as Partial<BehaviorObservation>;
  if (!observation.features || typeof observation.features !== 'object' ||
      !Number.isInteger(observation.observedKeys) || (observation.observedKeys as number) < 0 ||
      !['pointer', 'touch', 'unknown'].includes(observation.deviceContext ?? '') ||
      typeof observation.capturedAt !== 'string' || !Number.isFinite(Date.parse(observation.capturedAt)) ||
        typeof observation.featureCoverage !== 'number' || !Number.isFinite(observation.featureCoverage) ||
        observation.featureCoverage < 0 || observation.featureCoverage > 1) return false;
  const entries = Object.entries(observation.features);
  if (!entries.length || entries.some(([name, value]) =>
    !BEHAVIOR_FEATURES.includes(name as BehaviorFeature) ||
    typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
    value > FEATURE_MAXIMUMS[name as BehaviorFeature]
  )) return false;
  return true;
}

function summarize(values: number[], missingCount: number, feature: BehaviorFeature): FeatureDistribution {
  const center = median(values);
  const mad = median(values.map((value) => Math.abs(value - center)));
  const dispersion = standardDeviation(values);
  return {
    count: values.length,
    missingCount,
    mean: mean(values),
    median: center,
    standardDeviation: dispersion,
    medianAbsoluteDeviation: mad,
    q10: quantile(values, 0.1),
    q90: quantile(values, 0.9),
    reliability: values.length < 3 ? 'limited' : mad > FEATURE_FLOORS[feature] && dispersion > Math.max(1, Math.abs(center) * 0.5) ? 'variable' : 'stable',
  };
}

function summarizeObservations(observations: BehaviorObservation[]) {
  const result: Partial<Record<BehaviorFeature, FeatureDistribution>> = {};
  for (const feature of BEHAVIOR_FEATURES) {
    const values = observations
      .map((observation) => observation.features[feature])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (values.length) result[feature] = summarize(values, observations.length - values.length, feature);
  }
  return result;
}

function profileMetadata(observations: BehaviorObservation[], quarantinedSessions: number) {
  const stableTraits = summarizeObservations(observations);
  const presentFeatures = Object.keys(stableTraits) as BehaviorFeature[];
  const coverage = {
    keystroke: KEYSTROKE_FEATURES.filter((feature) => stableTraits[feature]).length / KEYSTROKE_FEATURES.length,
    mouse: MOUSE_FEATURES.filter((feature) => stableTraits[feature]).length / MOUSE_FEATURES.length,
    interaction: INTERACTION_FEATURES.filter((feature) => stableTraits[feature]).length / INTERACTION_FEATURES.length,
  };
  const matureStableFeatures = presentFeatures.filter((feature) =>
    (stableTraits[feature]?.count ?? 0) >= 5 && stableTraits[feature]?.reliability === 'stable',
  ).length;
  const maturity: ProfileMaturity = observations.length < 3
    ? 'immature'
    : observations.length < 8 || matureStableFeatures < 3 ? 'developing' : 'mature';
  const reliability: ProfileReliability = observations.length < 3 || presentFeatures.length < 3
    ? 'limited'
    : quarantinedSessions > observations.length ? 'unreliable'
      : observations.length >= 5 && matureStableFeatures >= 3 ? 'usable' : 'limited';
  const missingModalities = [
    coverage.keystroke < 0.5 ? 'Keystroke detail is incomplete' : null,
    coverage.mouse === 0 ? 'Mouse dynamics not observed' : null,
    coverage.interaction === 0 ? 'Interaction context not observed' : null,
  ].filter((value): value is string => value !== null);
  const deviceContextCounts: Record<DeviceContext, number> = {
    pointer: observations.filter((item) => item.deviceContext === 'pointer').length,
    touch: observations.filter((item) => item.deviceContext === 'touch').length,
    unknown: observations.filter((item) => item.deviceContext === 'unknown').length,
  };
  return {
    stableTraits,
    signalCoverage: coverage,
    maturity,
    reliability,
    missingModalities,
    sessionDiversity: {
      distinctDeviceContexts: Object.values(deviceContextCounts).filter((count) => count > 0).length,
      deviceContextCounts,
    },
  };
}

export function initializeBehavioralProfile(observations: BehaviorObservation[]): BehavioralProfile {
  if (observations.length < 3 || observations.some((observation) => !validateBehaviorObservation(observation))) {
    throw new Error('At least three valid numeric observations are required to initialize a profile.');
  }
  const boundedObservations = observations.slice(-100);
  const metadata = profileMetadata(boundedObservations, 0);
  const contexts: BehavioralProfile['contextualTraits'] = {};
  for (const context of ['pointer', 'touch'] as const) {
    const contextual = boundedObservations.filter((observation) => observation.deviceContext === context);
    if (contextual.length >= 3) contexts[context] = summarizeObservations(contextual);
  }
  return {
    schemaVersion: 1,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    acceptedSessions: boundedObservations.length,
    quarantinedSessions: 0,
    ...metadata,
    recentState: boundedObservations[boundedObservations.length - 1].features,
    contextualTraits: contexts,
    updateHistory: [{
      revision: 1,
      at: new Date().toISOString(),
      outcome: 'initialized',
      reason: 'Explicitly consented multi-session baseline created.',
      clippedFeatures: [],
    }],
    observations: boundedObservations,
  };
}

function updateProfile(profile: BehavioralProfile, observation: BehaviorObservation): BehavioralProfile {
  const observations = [...profile.observations, observation].slice(-100);
  const metadata = profileMetadata(observations, profile.quarantinedSessions);
  const contexts: BehavioralProfile['contextualTraits'] = {};
  for (const context of ['pointer', 'touch'] as const) {
    const contextual = observations.filter((item) => item.deviceContext === context);
    if (contextual.length >= 3) contexts[context] = summarizeObservations(contextual);
  }
  const revision = profile.revision + 1;
  const update: ProfileUpdate = {
    revision,
    at: new Date().toISOString(),
    outcome: 'accepted',
    reason: 'Eligible low-risk observation accepted with bounded feature updates.',
    clippedFeatures: [],
  };
  return {
    ...profile,
    revision,
    updatedAt: new Date().toISOString(),
    acceptedSessions: profile.acceptedSessions + 1,
    ...metadata,
    recentState: observation.features,
    contextualTraits: contexts,
    observations,
    updateHistory: [...profile.updateHistory, update].slice(-50),
  };
}

export function adaptBehavioralProfile(
  profile: BehavioralProfile,
  observation: BehaviorObservation,
): { profile: BehavioralProfile; accepted: boolean; reason: string } {
  if (!validateBehaviorObservation(observation) || observation.observedKeys < 20 ||
      typeof observation.features.avgHoldTime !== 'number' ||
      typeof observation.features.avgFlightTime !== 'number') {
    return quarantine(profile, 'Observation failed completeness or timing validation.');
  }

  const comparison = compareBehavior(profile, observation);
  if (comparison.deviations.length >= 3 &&
      comparison.deviations.filter((deviation) => deviation.normalizedDeviation > 4).length > comparison.deviations.length / 2) {
    return quarantine(profile, 'Observation was quarantined after a large multi-feature baseline deviation.');
  }

  const clippedFeatures: BehaviorFeature[] = [];
  const boundedFeatures: BehaviorFeatures = { ...observation.features };
  for (const [featureName, value] of Object.entries(boundedFeatures)) {
    const feature = featureName as BehaviorFeature;
    const distribution = profile.stableTraits[feature];
    if (!distribution) continue;
    const limit = Math.max(
      FEATURE_FLOORS[feature],
      distribution.medianAbsoluteDeviation * 3,
      Math.abs(distribution.median) * 0.15,
    );
    const boundedValue = Math.min(distribution.median + limit, Math.max(distribution.median - limit, value as number));
    if (boundedValue !== value) {
      boundedFeatures[feature] = boundedValue;
      clippedFeatures.push(feature);
    }
  }

  const nextObservation = { ...observation, features: boundedFeatures };
  const nextProfile = updateProfile(profile, nextObservation);
  if (clippedFeatures.length) {
    const last = nextProfile.updateHistory[nextProfile.updateHistory.length - 1];
    last.reason = 'Eligible observation accepted with per-feature update limits applied.';
    last.clippedFeatures = clippedFeatures;
  }
  return { profile: nextProfile, accepted: true, reason: 'Observation accepted with bounded adaptation.' };
}

export function recordQuarantinedObservation(profile: BehavioralProfile, reason: string): BehavioralProfile {
  return quarantine(profile, reason).profile;
}

function quarantine(profile: BehavioralProfile, reason: string) {
  const revision = profile.revision + 1;
  const update: ProfileUpdate = {
    revision,
    at: new Date().toISOString(),
    outcome: 'quarantined',
    reason,
    clippedFeatures: [],
  };
  const nextProfile: BehavioralProfile = {
    ...profile,
    revision,
    updatedAt: new Date().toISOString(),
    quarantinedSessions: profile.quarantinedSessions + 1,
    reliability: profile.quarantinedSessions + 1 > profile.acceptedSessions ? 'unreliable' : profile.reliability,
    updateHistory: [...profile.updateHistory, update].slice(-50),
  };
  return { profile: nextProfile, accepted: false, reason };
}

export function compareBehavior(profile: BehavioralProfile, observation: BehaviorObservation): ProfileComparison {
  const deviations: ProfileComparison['deviations'] = [];
  const contextual = profile.contextualTraits[observation.deviceContext];
  let contextualBaselineUsed = false;
  for (const [featureName, value] of Object.entries(observation.features)) {
    const feature = featureName as BehaviorFeature;
    const contextualDistribution = contextual?.[feature];
    const distribution = contextualDistribution && contextualDistribution.count >= 3
      ? contextualDistribution
      : profile.stableTraits[feature];
    if (distribution === contextualDistribution && contextualDistribution) contextualBaselineUsed = true;
    if (!distribution || distribution.count < 3 || typeof value !== 'number') continue;
    const variability = Math.max(
      FEATURE_FLOORS[feature],
      distribution.medianAbsoluteDeviation * 1.4826,
      Math.abs(distribution.median) * 0.05,
    );
    deviations.push({
      feature,
      observed: value,
      expectedMedian: distribution.median,
      expectedVariability: variability,
      normalizedDeviation: Math.abs(value - distribution.median) / variability,
    });
  }
  if (deviations.length < 3) return {
    similarity: null,
    comparableFeatures: deviations.length,
    contextualBaselineUsed,
    deviations,
  };
  const averageDeviation = mean(deviations.map((item) => Math.min(4, item.normalizedDeviation) / 4));
  return {
    similarity: Math.max(0, Math.min(1, 1 - averageDeviation)),
    comparableFeatures: deviations.length,
    contextualBaselineUsed,
    deviations,
  };
}

export function profileFromStoredValue(value: unknown): BehavioralProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const direct = value as Partial<BehavioralProfile>;
  if (direct.schemaVersion === 1 && Array.isArray(direct.observations) &&
      direct.observations.every(validateBehaviorObservation) && direct.stableTraits &&
      typeof direct.revision === 'number') return direct as BehavioralProfile;
  const stored = value as { behavioralProfile?: unknown; sessions?: unknown };
  const candidate = stored.behavioralProfile;
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const profile = candidate as BehavioralProfile;
    if (profile.schemaVersion === 1 && Array.isArray(profile.observations) &&
        profile.observations.every(validateBehaviorObservation) && profile.stableTraits &&
        typeof profile.revision === 'number') return profile;
  }
  if (Array.isArray(stored.sessions) && stored.sessions.length >= 3 &&
      stored.sessions.every(isValidLegacyVector)) {
    return initializeBehavioralProfile(stored.sessions.map((session) => observationFromRawVector(session)));
  }
  return null;
}

export function serializeBehavioralProfile(profile: BehavioralProfile) {
  return { behavioralProfile: profile };
}
