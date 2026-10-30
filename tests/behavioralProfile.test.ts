import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptBehavioralProfile,
  compareBehavior,
  deriveBehaviorObservation,
  initializeBehavioralProfile,
  observationFromRawVector,
  profileFromStoredValue,
  validateBehaviorObservation,
} from '../lib/behavioralProfile.ts';

function observation(shift = 0, context: 'pointer' | 'touch' | 'unknown' = 'pointer') {
  return deriveBehaviorObservation({
    holdTimes: Array.from({ length: 30 }, (_, index) => 100 + shift + (index % 5) * 2),
    flightTimes: Array.from({ length: 30 }, (_, index) => 150 + shift + (index % 6) * 3),
    elapsedMs: 60_000,
    characterCount: 250,
    cursorSamples: Array.from({ length: 12 }, (_, index) => ({
      at: index * 60,
      x: index * 8 + (index % 2),
      y: index * 5,
    })),
    clickTimes: [10, 500, 1010],
    interactionTimes: [20, 200, 400, 900],
    idleMs: 500,
    focusTransitions: 2,
    deviceContext: context,
  });
}

function initialized() {
  return initializeBehavioralProfile([observation(), observation(1), observation(-1)]);
}

test('extracts multi-dimensional numeric summaries without storing text or coordinates', () => {
  const result = observation();
  assert.equal(validateBehaviorObservation(result), true);
  assert.equal(result.features.medianHoldTime, 104);
  assert.equal(typeof result.features.digraphTiming, 'number');
  assert.equal(typeof result.features.trigraphTiming, 'number');
  assert.equal(typeof result.features.avgCursorVelocity, 'number');
  assert.equal(typeof result.features.clickInterval, 'number');
  assert.equal(typeof result.features.idleRatio, 'number');
  assert.equal('text' in result, false);
  assert.equal('keys' in result, false);
  assert.equal('cursorSamples' in result, false);
});

test('initial profile tracks maturity, missing modalities, variability, and contextual sufficiency', () => {
  const profile = initializeBehavioralProfile([
    observation(0, 'pointer'),
    observation(2, 'pointer'),
    observation(-2, 'touch'),
  ]);
  assert.equal(profile.acceptedSessions, 3);
  assert.equal(profile.maturity, 'developing');
  assert.equal(profile.reliability, 'limited');
  assert.equal(profile.signalCoverage.keystroke, 1);
  assert.equal(profile.contextualTraits.pointer, undefined);
  assert.equal(profile.contextualTraits.touch, undefined);
  assert.equal(profile.stableTraits.avgHoldTime?.count, 3);
  assert.equal(profile.updateHistory[0].outcome, 'initialized');
});

test('missing modalities remain explicit instead of becoming zero-valued features', () => {
  const sparse = deriveBehaviorObservation({
    holdTimes: [100, 110, 105],
    flightTimes: [],
    elapsedMs: 0,
    characterCount: 0,
    cursorSamples: [],
    clickTimes: [],
    interactionTimes: [],
    idleMs: 0,
    focusTransitions: 0,
    deviceContext: 'unknown',
  });
  assert.equal(sparse.features.avgFlightTime, undefined);
  assert.equal(validateBehaviorObservation(sparse), true);
  const profile = initializeBehavioralProfile([sparse, sparse, sparse]);
  assert.ok(profile.missingModalities.includes('Mouse dynamics not observed'));
});

test('natural session variation is represented by robust dispersion and similarity', () => {
  const profile = initializeBehavioralProfile([observation(-2), observation(), observation(2)]);
  const comparison = compareBehavior(profile, observation(1));
  assert.ok((comparison.similarity ?? 0) > 0.8);
  assert.ok(comparison.deviations.some((item) => item.feature === 'avgHoldTime' && item.expectedVariability > 0));
});

test('adaptation limits each feature step and versions accepted profile updates', () => {
  const profile = initialized();
  const baselineMedian = profile.stableTraits.avgHoldTime?.median ?? 0;
  const changed = observation(80);
  const result = adaptBehavioralProfile(profile, changed);
  assert.equal(result.accepted, true);
  assert.equal(result.profile.revision, profile.revision + 1);
  assert.equal(result.profile.acceptedSessions, 4);
  assert.equal(result.profile.updateHistory.at(-1)?.outcome, 'accepted');
  assert.ok(Math.abs((result.profile.stableTraits.avgHoldTime?.median ?? 0) - baselineMedian) < 20);
  assert.ok((result.profile.updateHistory.at(-1)?.clippedFeatures.length ?? 0) > 0);
});

test('large multi-feature deviation is quarantined without changing stable observations', () => {
  const profile = initialized();
  const outlier = deriveBehaviorObservation({
    holdTimes: Array.from({ length: 30 }, () => 400),
    flightTimes: Array.from({ length: 30 }, () => 900),
    elapsedMs: 60_000,
    characterCount: 250,
    cursorSamples: [],
    clickTimes: [],
    interactionTimes: [],
    idleMs: 0,
    focusTransitions: 0,
    deviceContext: 'unknown',
  });
  const result = adaptBehavioralProfile(profile, outlier);
  assert.equal(result.accepted, false);
  assert.equal(result.profile.acceptedSessions, profile.acceptedSessions);
  assert.equal(result.profile.quarantinedSessions, 1);
  assert.equal(result.profile.updateHistory.at(-1)?.outcome, 'quarantined');
});

test('cold-start and incomplete timing observations cannot be used for a reliable comparison', () => {
  const incomplete = observationFromRawVector({
    avgHoldTime: 100,
    avgFlightTime: 150,
    wpm: 45,
    holdTimeVariance: 8,
    flightTimeVariance: 10,
  });
  const profile = initializeBehavioralProfile([incomplete, incomplete, incomplete]);
  const current = observation();
  assert.equal(compareBehavior(profile, current).similarity === null, false);
  assert.throws(() => initializeBehavioralProfile([incomplete, incomplete]), /At least three/);
  const coldStart = initializeBehavioralProfile([incomplete, incomplete, incomplete]);
  assert.equal(coldStart.maturity, 'developing');
});

test('legacy vectors migrate into an explicitly incomplete profile', () => {
  const profile = profileFromStoredValue({
    sessions: [
      { avgHoldTime: 100, avgFlightTime: 150, wpm: 45, holdTimeVariance: 8, flightTimeVariance: 10 },
      { avgHoldTime: 102, avgFlightTime: 152, wpm: 44, holdTimeVariance: 9, flightTimeVariance: 11 },
      { avgHoldTime: 98, avgFlightTime: 148, wpm: 46, holdTimeVariance: 7, flightTimeVariance: 9 },
    ],
  });
  assert.ok(profile);
  assert.equal(profile.maturity, 'developing');
  assert.ok(profile.missingModalities.includes('Mouse dynamics not observed'));
});
