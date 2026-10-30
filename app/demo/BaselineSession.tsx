'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IGNORED_KEYS,
  KeystrokeEvent,
  FlightEvent,
  RawVector,
  estimateAccuracy,
  accuracyLabel,
  wordCount,
  extractRawVector,
} from './biometrics';
import { enrollSessionApi } from '@/lib/apiClient';

// ── 3 Baseline Passages ──────────────────────────────────────────────────────
const BASELINE_PASSAGES = [
  'The internet was originally developed as a decentralized communication network. Over several decades it evolved from a small academic experiment into a global infrastructure connecting billions of people across every nation on the planet.',
  'Machine learning enables computers to learn patterns from data without being explicitly programmed. Algorithms trained on large datasets can recognize images, translate languages, and detect fraud in financial transactions.',
  'Behavioral biometrics studies uniquely identifying patterns in human activity. Unlike physical biometrics such as fingerprints, behavioral signals like typing rhythm evolve continuously and remain uniquely your own.',
];

const MIN_WORDS = 20;

const LOCK_STEPS = [
  'Extracting keystroke vectors (S1–S3)',
  'Normalizing feature dimensions',
  'Computing behavioral centroid',
  'Locking behavioral model',
];

interface Props {
  onComplete: (sessions: RawVector[]) => void;
}

export default function BaselineSession({ onComplete }: Props) {
  const [currentSessionIndex, setCurrentSessionIndex] = useState(0);
  const [typed, setTyped] = useState('');
  const [hasBackspace, setHasBackspace] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [isPasted, setIsPasted] = useState(false);
  const [lockStep, setLockStep] = useState(-1);
  const [locked, setLocked] = useState(false);

  const collectedVectorsRef = useRef<RawVector[]>([]);

  // Keystroke tracking refs
  const downMap = useRef(new Map<string, number>());
  const keystrokesRef = useRef<KeystrokeEvent[]>([]);
  const flightsRef = useRef<FlightEvent[]>([]);
  const lastKeyRef = useRef<string | null>(null);
  const lastUpTimeRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 150);
  }, [currentSessionIndex]);

  const currentPassage = BASELINE_PASSAGES[currentSessionIndex];

  // Derived metrics
  const wc = wordCount(typed);
  const canSubmit = wc >= MIN_WORDS;
  const remaining = Math.max(0, MIN_WORDS - wc);
  const progressPct = Math.min(100, (wc / MIN_WORDS) * 100);

  // Live flight times for accuracy calculation
  const accuracy = canSubmit
    ? estimateAccuracy({
        wordCount: wc,
        flightTimes: flightsRef.current.map(f => f.flightTime),
        holdTimes: keystrokesRef.current.map(k => k.holdTime),
      })
    : 0;

  const { label: accLabel, color: accColor } = accuracyLabel(accuracy);

  // Real-time character-by-character typo detection
  let firstTypoIndex = -1;
  let firstTypoExpected = '';
  let firstTypoActual = '';
  let typoCount = 0;

  for (let i = 0; i < typed.length; i++) {
    if (i < currentPassage.length) {
      if (typed[i].toLowerCase() !== currentPassage[i].toLowerCase()) {
        typoCount++;
        if (firstTypoIndex === -1) {
          firstTypoIndex = i;
          firstTypoExpected = currentPassage[i] === ' ' ? 'Space' : currentPassage[i];
          firstTypoActual = typed[i] === ' ' ? 'Space' : typed[i];
        }
      }
    }
  }

  const hasTypo = firstTypoIndex !== -1;

  const resetSessionRefs = () => {
    setTyped('');
    setHasBackspace(false);
    downMap.current.clear();
    keystrokesRef.current = [];
    flightsRef.current = [];
    lastKeyRef.current = null;
    lastUpTimeRef.current = null;
    startTimeRef.current = null;
  };

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.repeat) return;
    const { key } = e;
    if (IGNORED_KEYS.has(key)) {
      if (key === 'Backspace') setHasBackspace(true);
      return;
    }
    const now = performance.now();
    if (!startTimeRef.current) startTimeRef.current = now;
    downMap.current.set(key, now);

    // Flight time: gap between last key-up and this key-down
    if (lastUpTimeRef.current !== null && lastKeyRef.current !== null) {
      flightsRef.current.push({
        fromKey: lastKeyRef.current,
        toKey: key,
        flightTime: now - lastUpTimeRef.current,
      });
    }
  }, []);

  const onKeyUp = useCallback((e: React.KeyboardEvent) => {
    const { key } = e;
    if (IGNORED_KEYS.has(key)) return;
    const now = performance.now();
    const downTime = downMap.current.get(key);
    if (downTime !== undefined) {
      keystrokesRef.current.push({ key, downTime, upTime: now, holdTime: now - downTime });
      downMap.current.delete(key);
    }
    lastUpTimeRef.current = now;
    lastKeyRef.current = key;
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTyped(e.target.value);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;

    const totalMs = startTimeRef.current
      ? performance.now() - startTimeRef.current
      : 3000;
    const vector = extractRawVector({
      keystrokes: keystrokesRef.current,
      flights: flightsRef.current,
      totalDurationMs: totalMs,
      charCount: typed.length,
    });

    const newVectors = [...collectedVectorsRef.current, vector];
    collectedVectorsRef.current = newVectors;

    // Send numeric vector to backend /api/enroll (3s timeout with silent local fallback)
    enrollSessionApi(vector).catch(() => {});

    if (currentSessionIndex < 2) {
      // Advance to next session
      resetSessionRefs();
      setCurrentSessionIndex(prev => prev + 1);
    } else {
      // 3 sessions complete - lock model
      setIsLocking(true);
      let step = 0;
      const interval = setInterval(() => {
        setLockStep(step);
        step++;
        if (step >= LOCK_STEPS.length) {
          clearInterval(interval);
          setLocked(true);
          setTimeout(() => {
            onComplete(collectedVectorsRef.current);
          }, 600);
        }
      }, 420);
    }
  }, [canSubmit, typed, currentSessionIndex, onComplete]);

  // ── Loading state ────────────────────────────────────────────────────────
  if (isPasted) {
    return (
      <div style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }} className="fade-in">
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(255,107,53,0.1)', border: '2px solid rgba(255,107,53,0.3)', margin: '0 auto 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff6b35" strokeWidth="2.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1rem', color: '#ff6b35', margin: '0 0 0.5rem', fontWeight: 600 }}>
          ZERO-TELEMETRY EVENT DETECTED
        </p>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted-foreground)', margin: '0 0 1.5rem', lineHeight: 1.5 }}>
          Paste or autofill action intercepted. No behavioral biometrics could be extracted.
        </p>
        <button
          onClick={() => {
            setIsPasted(false);
            resetSessionRefs();
          }}
          style={{
            padding: '0.875rem 1.5rem', borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--card)',
            color: 'var(--foreground)',
            cursor: 'pointer',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '0.82rem', fontWeight: 600,
            transition: 'all 0.2s',
          }}
        >
          Reset and Type Naturally
        </button>
      </div>
    );
  }

  if (isLocking) {
    return (
      <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }} className="fade-in">
        <div style={{ marginBottom: '2rem' }}>
          {locked ? (
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              border: '2px solid #00f5d4', background: 'rgba(0,245,212,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1rem',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00f5d4" strokeWidth="2.5">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
          ) : (
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              border: '2px solid rgba(0,245,212,0.2)', borderTop: '2px solid #00f5d4',
              margin: '0 auto 1rem',
            }} className="spinner" />
          )}
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.88rem', color: '#00f5d4', margin: 0 }}>
            {locked ? 'BASELINE MODEL LOCKED (3 SESSIONS)' : 'TRAINING BEHAVIORAL MODEL…'}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', textAlign: 'left' }}>
          {LOCK_STEPS.map((step, idx) => (
            <div key={step} style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              opacity: idx <= lockStep ? 1 : 0.25,
              transition: 'opacity 0.3s',
              fontSize: '0.8rem',
            }}>
              {idx < lockStep ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00f5d4" strokeWidth="2.5">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : idx === lockStep ? (
                <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #00f5d4', borderTop: '2px solid transparent', flexShrink: 0 }} className="spinner" />
              ) : (
                <div style={{ width: 14, height: 14, borderRadius: '50%', border: '1px solid #1a2628', flexShrink: 0 }} />
              )}
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: idx <= lockStep ? '#00f5d4' : '#6b7e83' }}>
                {step}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Accuracy ring SVG ────────────────────────────────────────────────────
  const R = 28;
  const circ = 2 * Math.PI * R;
  const ringOffset = circ - (accuracy / 100) * circ;

  return (
    <div style={{ padding: '1.5rem' }} className="fade-in">
      {/* Session progress indicator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', borderBottom: '1px solid rgba(0,245,212,0.15)', paddingBottom: '0.625rem' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem', color: '#00f5d4', fontWeight: 600, letterSpacing: '0.04em' }}>
          SESSION {currentSessionIndex + 1} OF 3 — BASELINE ENROLLMENT
        </span>
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: idx < currentSessionIndex ? '#00f5d4' : idx === currentSessionIndex ? 'rgba(0,245,212,0.5)' : '#1a2628',
                border: idx === currentSessionIndex ? '1.5px solid #00f5d4' : 'none',
                transition: 'all 0.3s',
              }}
            />
          ))}
        </div>
      </div>

      {/* Header info */}
      <div style={{ marginBottom: '1rem' }}>
        <p style={{ fontSize: '0.82rem', color: 'var(--muted-foreground)', margin: '0 0 0.375rem' }}>
          Type passage {currentSessionIndex + 1} naturally at your own pace:
        </p>
        <div style={{
          background: 'rgba(0,245,212,0.03)',
          border: hasTypo ? '1px solid rgba(255,107,53,0.35)' : '1px solid rgba(0,245,212,0.15)',
          borderRadius: 8,
          padding: '0.85rem 1rem',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.84rem',
          lineHeight: 1.65,
          userSelect: 'none',
          maxHeight: 130,
          overflowY: 'auto',
          transition: 'border-color 0.2s',
        }}>
          {currentPassage.split('').map((char, i) => {
            let color = 'rgba(240,244,245,0.4)';
            let bg = 'transparent';
            let borderBottom = 'none';

            if (i < typed.length) {
              const isCorrect = typed[i].toLowerCase() === char.toLowerCase();
              color = isCorrect ? '#00f5d4' : '#ff6b35';
              borderBottom = isCorrect ? '2px solid rgba(0,245,212,0.6)' : '2px solid #ff6b35';
              if (!isCorrect) bg = 'rgba(255,107,53,0.15)';
            } else if (i === typed.length) {
              color = '#ffffff';
              borderBottom = '2px solid #00f5d4';
            }

            return (
              <span
                key={i}
                style={{
                  color,
                  background: bg,
                  borderBottom,
                  transition: 'color 0.1s, border-bottom 0.1s',
                  fontWeight: i < typed.length ? 600 : 400,
                }}
              >
                {char}
              </span>
            );
          })}
        </div>
      </div>

      {/* Real-time Typo Warning Banner */}
      {hasTypo ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.45rem 0.85rem',
          borderRadius: 6,
          background: 'rgba(255, 107, 53, 0.12)',
          border: '1px solid rgba(255, 107, 53, 0.4)',
          color: '#ff6b35',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.74rem',
          marginBottom: '0.75rem',
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>
            <strong>TYPO WARNING:</strong> Expected &apos;{firstTypoExpected}&apos;, typed &apos;{firstTypoActual}&apos;. Press Backspace ⌫ to correct ({typoCount} mismatch{typoCount > 1 ? 'es' : ''}).
          </span>
        </div>
      ) : typed.length > 0 ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.35rem 0.85rem',
          borderRadius: 6,
          background: 'rgba(0, 245, 212, 0.05)',
          border: '1px solid rgba(0, 245, 212, 0.2)',
          color: '#00f5d4',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.72rem',
          marginBottom: '0.75rem',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00f5d4' }} />
          <span>TYPING ACCURATE // NO MISMATCHES DETECTED</span>
        </div>
      ) : null}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        className="typing-input"
        value={typed}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onPaste={(e) => {
          e.preventDefault();
          setIsPasted(true);
        }}
        placeholder={`Start typing passage ${currentSessionIndex + 1} above…`}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        rows={4}
        style={{
          width: '100%',
          resize: 'none',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.86rem',
          lineHeight: 1.7,
          borderColor: hasTypo
            ? '#ff6b35'
            : canSubmit
            ? '#00f5d4'
            : hasBackspace
            ? 'rgba(255,107,53,0.4)'
            : undefined,
          boxShadow: hasTypo ? '0 0 10px rgba(255, 107, 53, 0.25)' : undefined,
        }}
      />

      {/* Word count progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
        <div style={{ flex: 1, height: 4, background: '#1a2628', borderRadius: 9999, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            background: canSubmit ? '#00f5d4' : '#6b7e83',
            borderRadius: 9999,
            width: `${progressPct}%`,
            transition: 'width 0.15s, background 0.3s',
          }} />
        </div>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.68rem',
          color: canSubmit ? '#00f5d4' : '#6b7e83',
          minWidth: 80,
          textAlign: 'right',
        }}>
          {canSubmit ? `${wc} words completed` : `${remaining} more words`}
        </span>
      </div>

      {/* Accuracy meter */}
      {canSubmit && (
        <div className="fade-in" style={{
          marginTop: '1rem',
          padding: '0.875rem 1rem',
          background: 'rgba(0,245,212,0.04)',
          border: '1px solid rgba(0,245,212,0.15)',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
        }}>
          <svg width="68" height="68" viewBox="0 0 68 68" style={{ flexShrink: 0 }}>
            <circle cx="34" cy="34" r={R} className="accuracy-ring-track" />
            <circle
              cx="34" cy="34" r={R}
              className="accuracy-ring-fill"
              stroke={accColor}
              strokeDasharray={circ}
              strokeDashoffset={ringOffset}
              transform="rotate(-90 34 34)"
            />
            <text
              x="34" y="38"
              textAnchor="middle"
              fill={accColor}
              fontSize="12"
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
            >
              {accuracy}%
            </text>
          </svg>

          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', color: accColor, fontWeight: 600 }}>
              SESSION {currentSessionIndex + 1} ACCURACY
            </p>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'var(--foreground)', fontWeight: 500 }}>
              {accLabel}
            </p>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--muted-foreground)', lineHeight: 1.4 }}>
              {currentSessionIndex < 2
                ? `Session ${currentSessionIndex + 1} complete. Click below to continue to Session ${currentSessionIndex + 2}.`
                : `Final session complete! Ready to train and lock your 3-session behavioral centroid.`}
            </p>
          </div>
        </div>
      )}

      {/* Backspace warning */}
      {hasBackspace && !canSubmit && (
        <div className="fade-in" style={{
          marginTop: '0.75rem',
          padding: '0.625rem 0.875rem',
          background: 'rgba(255,107,53,0.07)',
          border: '1px solid rgba(255,107,53,0.25)',
          borderRadius: 8,
          fontSize: '0.78rem',
          color: '#ff6b35',
        }}>
          Backspace detected — type naturally without correcting for optimal telemetry.
        </div>
      )}

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          marginTop: '1rem',
          width: '100%',
          padding: '0.875rem',
          borderRadius: 10,
          border: canSubmit ? '1px solid rgba(0,245,212,0.5)' : '1px solid #1a2628',
          background: canSubmit ? 'rgba(0,245,212,0.1)' : 'transparent',
          color: canSubmit ? '#00f5d4' : '#6b7e83',
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.85rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          transition: 'all 0.2s',
          opacity: canSubmit ? 1 : 0.5,
        }}
        onMouseEnter={e => { if (canSubmit) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,245,212,0.18)'; }}
        onMouseLeave={e => { if (canSubmit) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,245,212,0.1)'; }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        {canSubmit
          ? currentSessionIndex < 2
            ? `Complete Session ${currentSessionIndex + 1} of 3 →`
            : `Lock 3-Session Baseline (${accuracy}% accuracy)`
          : `Type at least ${MIN_WORDS} words to complete Session ${currentSessionIndex + 1}`}
      </button>

      <p style={{ marginTop: '0.875rem', fontSize: '0.73rem', color: '#6b7e83', lineHeight: 1.5 }}>
        Session {currentSessionIndex + 1} of 3. Type naturally at your normal speed.{' '}
        <strong style={{ color: '#f0f4f5' }}>{MIN_WORDS} words minimum</strong> per session.
      </p>
    </div>
  );
}

