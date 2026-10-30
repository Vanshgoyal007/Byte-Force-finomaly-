/**
 * biometrics.ts — Core typing dynamics engine for Finomaly v3
 *
 * KEY FIX: Hybrid similarity metric
 * Previous: pure cosine similarity → always 98-99% even with wildly different WPM/hold/flight times
 * Fixed:   cosine similarity × Euclidean distance penalty
 *          Large deltas in any feature (WPM, hold time, flight time) now meaningfully reduce score.
 */

// ── Non-character keys to ignore ────────────────────────────────────────────
export const IGNORED_KEYS = new Set([
  'Shift','Control','Alt','Meta','CapsLock','Tab','Backspace','Delete',
  'ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape',
  'Home','End','PageUp','PageDown',
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
  'Insert','PrintScreen','ScrollLock','Pause','NumLock',
]);

// ── Normalisation bounds ─────────────────────────────────────────────────────
// Maps raw values to [0, 1] using percentile-calibrated bounds.
export const BOUNDS = {
  avgHoldTime:       { min: 40,  max: 250 },  // ms
  avgFlightTime:     { min: 20,  max: 400 },  // ms
  wpm:               { min: 15,  max: 150 },  // words per minute
  holdTimeVariance:  { min: 0,   max: 120 },  // ms std dev
  flightTimeVariance:{ min: 0,   max: 200 },  // ms std dev
} as const;

export type FeatureKey = keyof typeof BOUNDS;

// Exponential Moving Average (EMA) weight for verified match baseline adaptation
export const EMA_ALPHA = 0.12;

export function rawVectorToArray(raw: RawVector): [number, number, number, number, number] {
  return [raw.avgHoldTime, raw.avgFlightTime, raw.wpm, raw.holdTimeVariance, raw.flightTimeVariance];
}

export function arrayToRawVector(arr: [number, number, number, number, number] | number[]): RawVector {
  return {
    avgHoldTime: arr[0],
    avgFlightTime: arr[1],
    wpm: arr[2],
    holdTimeVariance: arr[3],
    flightTimeVariance: arr[4],
  };
}

export function applyEmaUpdate(oldBaseline: RawVector, liveVector: RawVector, alpha: number = EMA_ALPHA): RawVector {
  const keys: (keyof RawVector)[] = ['avgHoldTime', 'avgFlightTime', 'wpm', 'holdTimeVariance', 'flightTimeVariance'];
  const res = {} as RawVector;
  for (const k of keys) {
    res[k] = (1 - alpha) * oldBaseline[k] + alpha * liveVector[k];
  }
  return res;
}

export function validateNumericVector(v: unknown): { valid: boolean; error?: string; vector?: [number, number, number, number, number] } {
  if (!Array.isArray(v) || v.length !== 5) {
    return { valid: false, error: 'Vector must be an array of exactly 5 numbers' };
  }
  for (let i = 0; i < 5; i++) {
    const val = v[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      return { valid: false, error: `Vector element at index ${i} must be a finite number` };
    }
  }
  // Sane bounds checking
  const [hold, flight, wpm, hVar, fVar] = v as number[];
  if (hold < 0 || hold > 5000) return { valid: false, error: 'avgHoldTime out of sane bounds (0-5000ms)' };
  if (flight < -1000 || flight > 10000) return { valid: false, error: 'avgFlightTime out of sane bounds (-1000 to 10000ms)' };
  if (wpm < 0 || wpm > 1000) return { valid: false, error: 'wpm out of sane bounds (0-1000)' };
  if (hVar < 0 || hVar > 5000) return { valid: false, error: 'holdTimeVariance out of sane bounds (0-5000)' };
  if (fVar < 0 || fVar > 10000) return { valid: false, error: 'flightTimeVariance out of sane bounds (0-10000)' };

  return { valid: true, vector: [hold, flight, wpm, hVar, fVar] };
}

export interface KeystrokeEvent {
  key: string;
  downTime: number;
  upTime: number;
  holdTime: number;
}

export interface FlightEvent {
  fromKey: string;
  toKey: string;
  flightTime: number;
}

export interface RawVector {
  avgHoldTime: number;
  avgFlightTime: number;
  wpm: number;
  holdTimeVariance: number;
  flightTimeVariance: number;
}

export type NormVector = [number, number, number, number, number]; // same order as FEATURE_NAMES

export const FEATURE_NAMES = [
  'Avg Hold Time',
  'Avg Flight Time',
  'WPM',
  'Hold Variance',
  'Flight Variance',
] as const;

export const FEATURE_UNITS = ['ms', 'ms', 'wpm', 'ms', 'ms'] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────
function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map(v => (v - m) ** 2)));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function normalise(value: number, key: FeatureKey): number {
  const min: number = BOUNDS[key].min;
  const max: number = BOUNDS[key].max;
  if (max === min) return 0.5;
  return clamp01((value - min) / (max - min));
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ── Raw vector extraction ─────────────────────────────────────────────────────
export function extractRawVector(params: {
  keystrokes: KeystrokeEvent[];
  flights: FlightEvent[];
  totalDurationMs: number;
  charCount: number;
}): RawVector {
  const { keystrokes, flights, totalDurationMs, charCount } = params;
  const holdTimes = keystrokes.map(k => k.holdTime);
  const flightTimes = flights.map(f => f.flightTime);
  const minutes = totalDurationMs / 60_000;
  const wpm = minutes > 0 ? charCount / 5 / minutes : 0;

  return {
    avgHoldTime:        mean(holdTimes),
    avgFlightTime:      mean(flightTimes),
    wpm,
    holdTimeVariance:   stdDev(holdTimes),
    flightTimeVariance: stdDev(flightTimes),
  };
}

// ── Normalise to 5-element vector ─────────────────────────────────────────────
export function normaliseVector(raw: RawVector): NormVector {
  return [
    normalise(raw.avgHoldTime,        'avgHoldTime'),
    normalise(raw.avgFlightTime,      'avgFlightTime'),
    normalise(raw.wpm,                'wpm'),
    normalise(raw.holdTimeVariance,   'holdTimeVariance'),
    normalise(raw.flightTimeVariance, 'flightTimeVariance'),
  ];
}

// ── Average multiple raw vectors ──────────────────────────────────────────────
export function averageRawVectors(vectors: RawVector[]): RawVector {
  if (!vectors.length) throw new Error('No vectors');
  const keys: FeatureKey[] = ['avgHoldTime','avgFlightTime','wpm','holdTimeVariance','flightTimeVariance'];
  const result = {} as RawVector;
  for (const k of keys) {
    result[k] = mean(vectors.map(v => v[k]));
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// HYBRID SIMILARITY — THE CORE FIX
// ══════════════════════════════════════════════════════════════════════════════
//
// Problem with pure cosine similarity:
//   Cosine similarity measures the ANGLE between two vectors, not how far apart
//   the values actually are. Two people with very different WPM can produce vectors
//   that point in the same direction (e.g. [0.2, 0.3, 0.1, 0.2, 0.1] vs
//   [0.4, 0.6, 0.2, 0.4, 0.2] — cosine = 1.0 despite 2× difference!).
//
// Fix — hybrid score = cosine similarity × (1 − euclidean_penalty)^2
//
//   euclidean_penalty = normalized L2 distance / sqrt(D)
//     where D = 5 (number of dimensions)
//   This ensures:
//   • 0% delta across all features  → penalty ≈ 0    → final = cosine (high)
//   • 25% avg delta per feature     → penalty ≈ 0.25 → meaningful drop
//   • 50% avg delta per feature     → penalty ≈ 0.50 → score halved
//   • 100% avg delta (extreme diff) → penalty ≈ 1.0  → score near 0
//
// Feature weights — WPM and hold time are most discriminative, flight time second.
// ══════════════════════════════════════════════════════════════════════════════

const FEATURE_WEIGHTS = [
  1.5, // avgHoldTime      — most unique per person
  1.2, // avgFlightTime    — second most discriminative
  1.8, // wpm              — very discriminative (most noticeable)
  0.8, // holdTimeVariance — rhythm consistency
  0.7, // flightTimeVariance
];
const WEIGHT_SUM = FEATURE_WEIGHTS.reduce((a, b) => a + b, 0);

function dot(a: NormVector, b: NormVector): number {
  return a.reduce((sum, ai, i) => sum + ai * b[i] * FEATURE_WEIGHTS[i], 0);
}

function weightedMag(v: NormVector): number {
  return Math.sqrt(v.reduce((sum, vi, i) => sum + (vi ** 2) * FEATURE_WEIGHTS[i], 0));
}

function cosineSimilarity(a: NormVector, b: NormVector): number {
  const magA = weightedMag(a);
  const magB = weightedMag(b);
  if (magA === 0 || magB === 0) return 0;
  return clamp01(dot(a, b) / (magA * magB));
}

function euclideanPenalty(a: NormVector, b: NormVector): number {
  // Weighted squared differences, then normalize to [0,1]
  const weightedSSD = a.reduce((sum, ai, i) => {
    return sum + FEATURE_WEIGHTS[i] * (ai - b[i]) ** 2;
  }, 0);
  // max possible weighted SSD = sum of weights × 1^2 = WEIGHT_SUM
  const normalizedDist = Math.sqrt(weightedSSD / WEIGHT_SUM);
  return clamp01(normalizedDist);
}

/**
 * Compute the hybrid similarity score between a baseline centroid and a live vector.
 *
 * Returns a value in [0, 1]:
 *   ≥ 0.85  → identity match
 *   ≥ 0.65  → rushed / uncertain state  
 *   < 0.65  → behavioral anomaly
 */
export function hybridSimilarity(baseline: NormVector, live: NormVector): number {
  const cosine = cosineSimilarity(baseline, live);
  const penalty = euclideanPenalty(baseline, live);

  // Penalty is applied quadratically — small diffs don't penalise much,
  // but large diffs cause substantial drops.
  const penaltyFactor = (1 - penalty) ** 2;
  return clamp01(cosine * penaltyFactor);
}

// ── Per-session similarities (for the radar chart) ───────────────────────────
export function perSessionSimilarities(sessions: NormVector[], live: NormVector): number[] {
  return sessions.map(s => hybridSimilarity(s, live));
}

// ── Scoring band ──────────────────────────────────────────────────────────────
export type Band = 'match' | 'rushed' | 'anomaly';

export function scoreToBand(score: number): Band {
  if (score >= 0.85) return 'match';
  if (score >= 0.65) return 'rushed';
  return 'anomaly';
}

// ── Feature deltas (for display) ─────────────────────────────────────────────
export interface FeatureDelta {
  name: string;
  unit: string;
  rawBaseline: number;
  rawLive: number;
  normBaseline: number;
  normLive: number;
  delta: number;          // live - baseline (normalised)
  isAnomaly: boolean;     // |delta| > 0.25
}

export function computeFeatureDeltas(
  baselineRaw: RawVector,
  liveRaw: RawVector,
): FeatureDelta[] {
  const keys: FeatureKey[] = ['avgHoldTime','avgFlightTime','wpm','holdTimeVariance','flightTimeVariance'];
  const baselineNorm = normaliseVector(baselineRaw);
  const liveNorm = normaliseVector(liveRaw);

  return FEATURE_NAMES.map((name, i) => {
    const key = keys[i];
    const nb = baselineNorm[i];
    const nl = liveNorm[i];
    const delta = nl - nb;
    return {
      name,
      unit: FEATURE_UNITS[i],
      rawBaseline: baselineRaw[key],
      rawLive: liveRaw[key],
      normBaseline: nb,
      normLive: nl,
      delta,
      isAnomaly: Math.abs(delta) > 0.25,
    };
  });
}

// ── Accuracy estimator for baseline session ───────────────────────────────────
/**
 * Estimates baseline accuracy based on word count and typing consistency.
 * - Uses coefficient of variation (CV) of inter-key intervals (flight times)
 * - Low CV (consistent typing) → accuracy grows faster per word
 * - High CV (erratic typing)   → accuracy grows slower, needs more words
 *
 * Returns a value in [0, 100].
 */
export function estimateAccuracy(params: {
  wordCount: number;
  flightTimes: number[];
  holdTimes: number[];
}): number {
  const { wordCount: wc, flightTimes, holdTimes } = params;
  if (wc < 50) return 0;

  // Coefficient of variation for flight times (rhythm consistency)
  const allIntervals = [...flightTimes, ...holdTimes];
  const m = mean(allIntervals);
  const sd = stdDev(allIntervals);
  const cv = m > 0 ? sd / m : 1; // 0 = perfectly consistent, 1+ = very erratic

  // Base accuracy from word count alone (logarithmic growth)
  // At 50 words → ~45%, at 100 → ~65%, at 200 → ~85%, at 300 → ~95%
  const wordScore = clamp01(Math.log(wc / 50 + 1) / Math.log(7)); // log scale

  // Consistency bonus: lower CV = higher accuracy from fewer words
  // CV ≈ 0.3–0.5 is normal for humans. Above 0.8 is very erratic.
  const consistencyFactor = clamp01(1 - (cv - 0.3) / 0.8); // 1.0 at cv=0.3, 0 at cv=1.1

  // Blend: consistent typists get accuracy from word count faster
  // Erratic typists need more words before the average stabilises
  const consistentScore = wordScore * (0.7 + 0.3 * consistencyFactor);
  const accuracyRaw = 40 + consistentScore * 57; // range 40–97%

  return Math.min(97, Math.round(accuracyRaw));
}

// ── Accuracy label ────────────────────────────────────────────────────────────
export function accuracyLabel(pct: number): { label: string; color: string } {
  if (pct < 60) return { label: 'Building baseline…',  color: '#6b7e83' };
  if (pct < 75) return { label: 'Moderate accuracy',   color: '#ffa500' };
  if (pct < 88) return { label: 'Good accuracy',       color: '#00f5d4' };
  return              { label: 'High accuracy',         color: '#00f5d4' };
}
