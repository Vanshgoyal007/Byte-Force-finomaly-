'use client';

import { useCallback, useEffect, useState } from 'react';
import BaselineSession from './BaselineSession';
import LoginSession from './LoginSession';
import ResultsView from './ResultsView';
import { RawVector, NormVector, FeatureDelta, KeystrokeEvent } from './biometrics';

const STORAGE_KEY = 'finomaly_baseline_v4';

const LOGO_PATHS = [
  'M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4',
  'M14 13.12c0 2.38 0 6.38-1 8.88',
  'M17.29 21.02c.12-.6.43-2.3.5-3.02',
  'M2 12a10 10 0 0 1 18-6',
  'M2 16h.01',
  'M21.8 16c.2-2 .131-5.354 0-6',
  'M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2',
  'M8.65 22c.21-.66.45-1.32.57-2',
  'M9 6.8a6 6 0 0 1 9 5.2v2',
];

type Phase = 'baseline' | 'login' | 'results';

interface AuthResult {
  liveVector: RawVector;
  liveNorm: NormVector;
  baselineNorm: NormVector;
  similarity: number;
  perSession: number[];
  featureDeltas: FeatureDelta[];
  liveKeystrokes: KeystrokeEvent[];
  mode?: 'server' | 'local';
}

function loadSavedBaseline(): RawVector[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 4 || !Array.isArray(parsed.sessions) || parsed.sessions.length < 1) return null;
    return parsed.sessions;
  } catch {
    return null;
  }
}

export default function DemoModal() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('baseline');
  const [baselineSessions, setBaselineSessions] = useState<RawVector[]>([]);
  const [result, setResult] = useState<AuthResult | null>(null);

  useEffect(() => {
    const saved = loadSavedBaseline();
    if (saved && saved.length >= 1) {
      setBaselineSessions(saved);
      setPhase('login');
    }
  }, []);

  const close = () => setOpen(false);

  const onBaselineComplete = useCallback((sessions: RawVector[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 4, sessions }));
    } catch {}
    setBaselineSessions(sessions);
    setTimeout(() => setPhase('login'), 300);
  }, []);

  const onAuthResult = useCallback((r: AuthResult) => {
    setResult(r);
    setPhase('results');
  }, []);

  const onRetry = useCallback(() => {
    setResult(null);
    setPhase('login');
  }, []);

  const onReenroll = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setBaselineSessions([]);
    setResult(null);
    setPhase('baseline');
  }, []);

  const stepNum = phase === 'baseline' ? 1 : phase === 'login' ? 2 : 3;
  const stepLabel = phase === 'baseline' ? 'Enroll Baseline' : phase === 'login' ? 'Authenticate' : 'Analysis';

  return (
    <>
      {/* Launch button */}
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.625rem 1.25rem', borderRadius: 8,
          border: '1px solid rgba(0,245,212,0.5)', background: 'rgba(0,245,212,0.1)',
          color: '#00f5d4', cursor: 'pointer', fontSize: '0.875rem',
          fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', transition: 'all 0.2s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,245,212,0.18)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,245,212,0.1)')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {LOGO_PATHS.map((d, i) => <path key={i} d={d} />)}
        </svg>
        Launch Demo
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="hud-overlay"
          onClick={e => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="hud-panel fade-in">
            {/* Header */}
            <div className="hud-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  {LOGO_PATHS.map((d, i) => <path key={i} d={d} />)}
                </svg>
                <div>
                  <p style={{ margin: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem', fontWeight: 600 }}>
                    finomaly<span style={{ color: 'var(--primary)' }}>.</span> demo
                  </p>
                  <p style={{ margin: 0, fontSize: '0.68rem', color: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono, monospace' }}>
                    STEP {stepNum}/3 — {stepLabel.toUpperCase()}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {/* Step dots */}
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {[1, 2, 3].map(n => (
                    <div key={n} style={{
                      width: 24, height: 4, borderRadius: 9999,
                      background: n <= stepNum ? 'var(--primary)' : 'var(--border)',
                      transition: 'background 0.3s',
                    }} />
                  ))}
                </div>
                <button onClick={close} style={{ background: 'transparent', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', padding: '4px', lineHeight: 1 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Live Backend Connection Indicator */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 14px',
              background: 'rgba(0, 245, 212, 0.04)',
              borderBottom: '1px solid var(--border)',
              fontSize: '0.72rem',
              fontFamily: 'JetBrains Mono, monospace',
              color: 'var(--muted-foreground)',
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#00f5d4' }}>
                <span className="status-dot" style={{ width: 6, height: 6 }} />
                BACKEND ACTIVE // SUPABASE POSTGRES
              </span>
              <a
                href="/audit"
                target="_blank"
                rel="noreferrer"
                style={{
                  color: 'var(--muted-foreground)',
                  textDecoration: 'none',
                  fontSize: '0.7rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  transition: 'color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#00f5d4')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-foreground)')}
              >
                VIEW AUDIT LOG ↗
              </a>
            </div>

            {/* Phase content */}
            {phase === 'baseline' && <BaselineSession onComplete={onBaselineComplete} />}
            {phase === 'login' && (
              <LoginSession
                baselineSessions={baselineSessions}
                onResult={onAuthResult}
                onReenroll={onReenroll}
              />
            )}
            {phase === 'results' && result && (
              <ResultsView
                similarity={result.similarity}
                liveVector={result.liveVector}
                liveNorm={result.liveNorm}
                baselineNorm={result.baselineNorm}
                baselineSessions={baselineSessions}
                featureDeltas={result.featureDeltas}
                perSession={result.perSession}
                liveKeystrokes={result.liveKeystrokes}
                mode={result.mode}
                onRetry={onRetry}
                onClose={close}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
