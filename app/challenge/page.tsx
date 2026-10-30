'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  IGNORED_KEYS,
  KeystrokeEvent,
  FlightEvent,
  RawVector,
  NormVector,
  FeatureDelta,
  extractRawVector,
  normaliseVector,
  averageRawVectors,
  computeFeatureDeltas,
  hybridSimilarity,
  wordCount,
} from '@/app/demo/biometrics';
import { verifySessionApi } from '@/lib/apiClient';
import FlatRadarChart from '@/components/FlatRadarChart';
import Footer from '@/components/Footer';
import RhythmStrip from '@/components/RhythmStrip';

const BASELINE_PASSAGES = [
  'The internet was originally developed as a decentralized communication network. Over several decades it evolved from a small academic experiment into a global infrastructure connecting billions of people across every nation on the planet.',
  'Machine learning enables computers to learn patterns from data without being explicitly programmed. Algorithms trained on large datasets can recognize images, translate languages, and detect fraud in financial transactions.',
  'Behavioral biometrics studies uniquely identifying patterns in human activity. Unlike physical biometrics such as fingerprints, behavioral signals like typing rhythm evolve continuously and remain uniquely your own.',
];

const CHALLENGE_PASSPHRASE = 'behavioral authentication protects accounts where passwords cannot reach';

const MIN_WORDS = 20;

type Phase = 'explain' | 'personA' | 'personB' | 'result';

export default function ChallengePage() {
  const [lastRelease, setLastRelease] = useState(0);
  const [phase, setPhase] = useState<Phase>('explain');
  const [personAVectors, setPersonAVectors] = useState<RawVector[]>([]);
  const [passageIndex, setPassageIndex] = useState(0);
  const [typedText, setTypedText] = useState('');
  const [isPasted, setIsPasted] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);

  // Timer in plain seconds (no theatrical HUD)
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Results
  const [result, setResult] = useState<{
    similarity: number;
    liveVector: RawVector;
    liveNorm: NormVector;
    baselineNorm: NormVector;
    featureDeltas: FeatureDelta[];
  } | null>(null);

  // Keystrokes
  const downMap = useRef(new Map<string, number>());
  const keystrokesRef = useRef<KeystrokeEvent[]>([]);
  const flightsRef = useRef<FlightEvent[]>([]);
  const lastKeyRef = useRef<string | null>(null);
  const lastUpTimeRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Timer runner
  useEffect(() => {
    if (phase === 'personB') {
      timerIntervalRef.current = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [phase]);

  const resetTracking = () => {
    setTypedText('');
    setIsPasted(false);
    downMap.current.clear();
    keystrokesRef.current = [];
    flightsRef.current = [];
    lastKeyRef.current = null;
    lastUpTimeRef.current = null;
    startTimeRef.current = null;
    setTimeout(() => textareaRef.current?.focus(), 80);
  };

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.repeat) return;
    const { key } = e;
    if (IGNORED_KEYS.has(key)) return;
    const now = performance.now();
    if (!startTimeRef.current) startTimeRef.current = now;
    downMap.current.set(key, now);

    if (lastUpTimeRef.current !== null && lastKeyRef.current !== null) {
      const flight = Math.max(1, now - lastUpTimeRef.current);
      flightsRef.current.push({
        fromKey: lastKeyRef.current,
        toKey: key,
        flightTime: flight,
      });
    }
  }, []);

  const onKeyUp = useCallback((e: React.KeyboardEvent) => {
    const { key } = e;
    if (IGNORED_KEYS.has(key)) return;
    const now = performance.now();
    const downTime = downMap.current.get(key);
    if (downTime !== undefined) {
      const hold = Math.max(1, now - downTime);
      keystrokesRef.current.push({ key, downTime, upTime: now, holdTime: hold });
      downMap.current.delete(key);
    }
    lastUpTimeRef.current = now;
    lastKeyRef.current = key;
    setLastRelease(now);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    setIsPasted(true);
  }, []);

  // Person A submission
  const currentWords = wordCount(typedText);
  const canSubmitA = currentWords >= MIN_WORDS;

  const handlePersonASubmit = () => {
    if (!canSubmitA) return;
    const totalMs = startTimeRef.current ? performance.now() - startTimeRef.current : 3000;
    const vector = extractRawVector({
      keystrokes: keystrokesRef.current,
      flights: flightsRef.current,
      totalDurationMs: totalMs,
      charCount: typedText.length,
    });

    const updated = [...personAVectors, vector];
    setPersonAVectors(updated);

    if (passageIndex < 2) {
      setPassageIndex((i) => i + 1);
      resetTracking();
    } else {
      setPhase('personB');
      setElapsedSeconds(0);
      resetTracking();
    }
  };

  // Person B submission
  const canSubmitB = typedText.trim().length >= 25;

  const handlePersonBSubmit = async () => {
    if (!canSubmitB) return;
    setIsCalculating(true);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);

    const totalMs = startTimeRef.current ? performance.now() - startTimeRef.current : 3000;
    const liveVector = extractRawVector({
      keystrokes: keystrokesRef.current,
      flights: flightsRef.current,
      totalDurationMs: totalMs,
      charCount: typedText.length,
    });

    const baselineRaw = averageRawVectors(personAVectors);
    const bNorm = normaliseVector(baselineRaw);
    const lNorm = normaliseVector(liveVector);
    const score = hybridSimilarity(bNorm, lNorm);
    const deltas = computeFeatureDeltas(baselineRaw, liveVector);

    verifySessionApi(
      liveVector,
      { pasteDetected: isPasted, botSuspected: false },
      undefined,
      personAVectors
    ).catch(() => {});

    setResult({
      similarity: score,
      liveVector,
      liveNorm: lNorm,
      baselineNorm: bNorm,
      featureDeltas: deltas,
    });
    setIsCalculating(false);
    setPhase('result');
  };

  const handleResetAll = () => {
    setPersonAVectors([]);
    setPassageIndex(0);
    setResult(null);
    setElapsedSeconds(0);
    setPhase('explain');
    resetTracking();
  };

  const baselineRaw = useMemo(() => {
    return personAVectors.length > 0 ? averageRawVectors(personAVectors) : null;
  }, [personAVectors]);

  return (
    <>
      <main id="main-content" className="container challenge-main" style={{ paddingTop: '40px', paddingBottom: '72px', maxWidth: '880px' }}>
        <div style={{ marginBottom: '32px' }}>
          <span className="small text-muted" style={{ display: 'block', marginBottom: '8px' }}>
            Two-person challenge
          </span>
          <h1 style={{ marginBottom: '12px' }}>Imposter challenge</h1>
          <p className="body-text text-muted" style={{ maxWidth: '640px' }}>
            Test whether another person typing the exact same text can bypass your behavioral baseline.
          </p>
        </div>

        {(phase==='personA'||phase==='personB')&&<div className="challenge-live"><RhythmStrip keystrokes={keystrokesRef.current} flights={flightsRef.current} textLength={typedText.length} durationMs={startTimeRef.current?Math.max(0,lastRelease-startTimeRef.current):0}/></div>}
        {/* ── PHASE: EXPLAIN ── */}
        {phase === 'explain' && (
          <div className="panel" style={{ padding: '28px' }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Instructions</h2>
            
            <ol style={{ paddingLeft: '20px', lineHeight: 1.8, marginBottom: '24px', fontSize: '0.9375rem' }}>
              <li>
                <strong>Person A enrolls:</strong> Types 3 baseline passages to establish their personal timing signature.
              </li>
              <li>
                <strong>Person B attempts login:</strong> Sits at the keyboard and types the exact passphrase.
              </li>
              <li>
                <strong>Compare results:</strong> The engine checks whether Person B's cadence diverged from Person A's baseline.
              </li>
            </ol>

            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setPhase('personA');
                resetTracking();
              }}
            >
              Start as Person A
            </button>
          </div>
        )}

        {/* ── PHASE: PERSON A ENROLL ── */}
        {phase === 'personA' && (
          <div className="panel" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <h2 style={{ fontSize: '1.1rem', marginBottom: '4px' }}>
                  Person A: Passage {passageIndex + 1} of 3
                </h2>
                <p className="small text-muted">
                  Type the passage below naturally.
                </p>
              </div>
              <span className="small text-muted num-tabular">
                Passage {passageIndex + 1} / 3
              </span>
            </div>

            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                padding: '14px 16px',
                marginBottom: '16px',
                fontSize: '0.9375rem',
                lineHeight: 1.6,
                color: 'var(--text)',
                userSelect: 'none',
              }}
            >
              {BASELINE_PASSAGES[passageIndex]}
            </div>

            {isPasted && (
              <div style={{ background: 'var(--warning-light)', border: '1px solid #5a4930', color: 'var(--warning)', padding: '10px 14px', borderRadius: '4px', marginBottom: '16px', fontSize: '0.8125rem' }}>
                Pasting is disabled. Please type the passage manually.
              </div>
            )}

            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="challenge-a-input" className="small text-muted" style={{ display: 'block', marginBottom: '6px' }}>
                Person A input
              </label>
              <textarea
                id="challenge-a-input"
                ref={textareaRef}
                rows={4}
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                onKeyDown={onKeyDown}
                onKeyUp={onKeyUp}
                onPaste={handlePaste}
                placeholder="Type here..."
                autoFocus
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="small text-muted num-tabular">
                {currentWords} / {MIN_WORDS} words required
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handlePersonASubmit}
                disabled={!canSubmitA}
              >
                {passageIndex < 2 ? 'Next passage' : 'Hand keyboard to Person B'}
              </button>
            </div>
          </div>
        )}

        {/* ── PHASE: PERSON B CHALLENGE ── */}
        {phase === 'personB' && (
          <div className="panel" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <h2 style={{ fontSize: '1.1rem', marginBottom: '4px' }}>
                  Person B: Type the passphrase
                </h2>
                <p className="small text-muted">
                  Person B should now type the verification phrase below at their own pace.
                </p>
              </div>
              <div className="small text-muted num-tabular" style={{ background: 'var(--surface)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                Elapsed: {elapsedSeconds}s
              </div>
            </div>

            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                padding: '14px 16px',
                marginBottom: '16px',
                fontSize: '0.9375rem',
                lineHeight: 1.6,
                fontWeight: 500,
                color: 'var(--text)',
                userSelect: 'none',
              }}
            >
              {CHALLENGE_PASSPHRASE}
            </div>

            {isPasted && (
              <div style={{ background: 'var(--warning-light)', border: '1px solid #5a4930', color: 'var(--warning)', padding: '10px 14px', borderRadius: '4px', marginBottom: '16px', fontSize: '0.8125rem' }}>
                Pasting is disabled. Person B must type the text manually.
              </div>
            )}

            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="challenge-b-input" className="small text-muted" style={{ display: 'block', marginBottom: '6px' }}>
                Person B input
              </label>
              <textarea
                id="challenge-b-input"
                ref={textareaRef}
                rows={3}
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                onKeyDown={onKeyDown}
                onKeyUp={onKeyUp}
                onPaste={handlePaste}
                placeholder="Person B starts typing..."
                autoFocus
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="small text-muted num-tabular">
                {typedText.trim().length} characters typed
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handlePersonBSubmit}
                disabled={!canSubmitB || isCalculating}
              >
                {isCalculating ? 'Comparing...' : 'Submit challenge attempt'}
              </button>
            </div>
          </div>
        )}

        {/* ── PHASE: RESULT ── */}
        {phase === 'result' && result && baselineRaw && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="panel" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <div className="small text-muted" style={{ marginBottom: '4px' }}>Challenge outcome</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                    <span style={{ fontSize: '2rem', fontWeight: 600 }} className="num-tabular">
                      {(result.similarity * 100).toFixed(1)}%
                    </span>
                    {result.similarity >= 0.85 && (
                      <span className="chip chip-success">Matched Person A profile</span>
                    )}
                    {result.similarity >= 0.65 && result.similarity < 0.85 && (
                      <span className="chip chip-warning">Mild variance</span>
                    )}
                    {result.similarity < 0.65 && (
                      <span className="chip chip-danger">Anomaly detected (Imposter blocked)</span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" className="btn btn-primary" onClick={handleResetAll}>
                    Run new challenge
                  </button>
                  <Link href="/audit" className="btn btn-secondary">
                    View in audit log
                  </Link>
                </div>
              </div>

              <p className="body-text text-muted" style={{ fontSize: '0.875rem', margin: 0 }}>
                {result.similarity < 0.65
                  ? "Person B's hold and flight durations diverged significantly from Person A's baseline, successfully triggering an anomaly alert."
                  : "Person B's cadence fell within the baseline range of Person A."}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
              <div className="panel" style={{ padding: '20px' }}>
                <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '12px' }}>
                  Vector comparison
                </div>
                <FlatRadarChart
                  baselineRaw={baselineRaw}
                  liveRaw={result.liveVector}
                  baselineNorm={result.baselineNorm}
                  liveNorm={result.liveNorm}
                  featureDeltas={result.featureDeltas}
                />
              </div>

              <div className="panel" style={{ padding: '20px' }}>
                <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '12px' }}>
                  Signal comparison
                </div>
                <div className="table-wrapper">
                  <table className="fin-table">
                    <thead>
                      <tr>
                        <th>Signal</th>
                        <th>Person B</th>
                        <th>Person A</th>
                        <th>Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.featureDeltas.map((fd) => {
                        const diffPct = (fd.delta * 100).toFixed(1);
                        return (
                          <tr key={fd.name}>
                            <td style={{ fontWeight: 500 }}>{fd.name}</td>
                            <td className="num-tabular">{Math.round(fd.rawLive)} {fd.unit}</td>
                            <td className="num-tabular text-muted">{Math.round(fd.rawBaseline)} {fd.unit}</td>
                            <td className="num-tabular">
                              <span style={{ color: fd.isAnomaly ? 'var(--danger)' : 'var(--text)' }}>
                                {fd.delta > 0 ? `+${diffPct}%` : `${diffPct}%`}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </>
  );
}
