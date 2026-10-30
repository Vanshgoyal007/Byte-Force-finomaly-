import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidRawVector } from '../app/demo/biometrics.ts';
import {
  assessTransaction,
  calculateConfusionMetrics,
  canCompleteTransaction,
  completeTransaction,
} from '../lib/transactionRisk.ts';

const reliable = {
  similarity: 0.92,
  baselineSamples: 3,
  observedKeys: 30,
  amount: 40,
  newBeneficiary: false,
};

test('allows routine activity with reliable baseline and observation', () => {
  const result = assessTransaction(reliable);
  assert.equal(result.action, 'allow');
  assert.equal(result.evidenceReliable, true);
  assert.equal(result.riskScore, 8);
});

test('requires step-up for an intermediate match or high-value context', () => {
  assert.equal(assessTransaction({ ...reliable, similarity: 0.75 }).action, 'step-up');
  assert.equal(assessTransaction({ ...reliable, amount: 1000 }).action, 'step-up');
});

test('holds high-context transactions when evidence is strongly anomalous', () => {
  const result = assessTransaction({ ...reliable, similarity: 0.4, newBeneficiary: true });
  assert.equal(result.action, 'hold');
  assert.equal(canCompleteTransaction(result), false);
  assert.throws(() => completeTransaction(result), /cannot be completed/);
});

test('verified step-up permits the simulated transaction to proceed', () => {
  const result = assessTransaction({
    ...reliable,
    similarity: 0.4,
    amount: 2000,
    stepUpVerified: true,
  });
  assert.equal(result.action, 'allow');
  assert.equal(canCompleteTransaction(result), true);
});

test('verified step-up is an explicit fallback when behavioral evidence is unavailable', () => {
  const result = assessTransaction({
    ...reliable,
    similarity: null,
    baselineSamples: 0,
    observedKeys: 0,
    newBeneficiary: true,
    stepUpVerified: true,
  });
  assert.equal(result.action, 'allow');
  assert.equal(result.evidenceReliable, false);
  assert.equal(canCompleteTransaction(result), true);
});

test('insufficient evidence uses a context-aware fallback, not an automatic block', () => {
  const routine = assessTransaction({ ...reliable, similarity: null, baselineSamples: 1 });
  const highContext = assessTransaction({
    ...reliable,
    similarity: null,
    baselineSamples: 1,
    newBeneficiary: true,
  });
  assert.equal(routine.action, 'insufficient-evidence');
  assert.equal(routine.fallback, 'allow');
  assert.equal(canCompleteTransaction(routine), true);
  assert.equal(highContext.fallback, 'step-up');
  assert.equal(canCompleteTransaction(highContext), false);
});

test('an immature profile is insufficient evidence, not an impostor finding', () => {
  const result = assessTransaction({ ...reliable, profileReliable: false });
  assert.equal(result.action, 'insufficient-evidence');
  assert.equal(result.evidenceReliable, false);
  assert.equal(result.fallback, 'allow');
  assert.ok(result.reasons.some((reason) => reason.includes('not an impostor finding')));
});

test('uses measured profile deviations in the explanation', () => {
  const result = assessTransaction({
    ...reliable,
    similarity: 0.75,
    featureDeviations: [{
      feature: 'medianHoldTime',
      observed: 180,
      expectedMedian: 110,
      expectedVariability: 15,
      normalizedDeviation: 4.67,
    }],
  });
  assert.ok(result.reasons.some((reason) => reason.includes('medianHoldTime') && reason.includes('4.7')));
  assert.equal(result.featureDeviations?.[0].observed, 180);
});

test('rejects invalid transaction and observation inputs', () => {
  assert.throws(() => assessTransaction({ ...reliable, amount: 0 }), /amount/);
  assert.throws(() => assessTransaction({ ...reliable, similarity: 1.5 }), /Similarity/);
});

test('calculates suspicious-positive confusion metrics and excludes unscored rows', () => {
  const result = calculateConfusionMetrics(
    [
      { label: 'suspicious', similarity: 0.4 },
      { label: 'suspicious', similarity: 0.8 },
      { label: 'genuine', similarity: 0.9 },
      { label: 'genuine', similarity: 0.5 },
      { label: 'insufficient', similarity: null },
      { label: 'unlabeled', similarity: 0.3 },
    ],
    0.65,
  );
  assert.deepEqual(
    [result.truePositive, result.trueNegative, result.falsePositive, result.falseNegative, result.excluded],
    [1, 1, 1, 1, 2],
  );
  assert.equal(result.precision, 0.5);
  assert.equal(result.recall, 0.5);
  assert.equal(result.f1, 0.5);
  assert.equal(result.specificity, 0.5);
  assert.equal(result.falsePositiveRate, 0.5);
  assert.equal(result.falseNegativeRate, 0.5);
});

test('returns safe zero-denominator metrics', () => {
  const result = calculateConfusionMetrics([], 0.65);
  assert.deepEqual(
    [
      result.precision,
      result.recall,
      result.f1,
      result.specificity,
      result.falsePositiveRate,
      result.falseNegativeRate,
    ],
    [0, 0, 0, 0, 0, 0],
  );
});

test('accepts only finite, bounded, non-zero timing baselines', () => {
  assert.equal(isValidRawVector({
    avgHoldTime: 100,
    avgFlightTime: 80,
    wpm: 50,
    holdTimeVariance: 12,
    flightTimeVariance: 20,
  }), true);
  assert.equal(isValidRawVector({
    avgHoldTime: 0,
    avgFlightTime: 80,
    wpm: 50,
    holdTimeVariance: 12,
    flightTimeVariance: 20,
  }), false);
  assert.equal(isValidRawVector({
    avgHoldTime: 100,
    avgFlightTime: Number.NaN,
    wpm: 50,
    holdTimeVariance: 12,
    flightTimeVariance: 20,
  }), false);
});
