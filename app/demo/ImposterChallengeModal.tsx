'use client';

import { useCallback, useState } from 'react';
import BaselineSession from './BaselineSession';
import LoginSession from './LoginSession';
import ResultsView from './ResultsView';
import { RawVector, NormVector, FeatureDelta, KeystrokeEvent } from './biometrics';

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

type Phase = 'intro' | 'baseline' | 'login' | 'results';

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

export default function ImposterChallengeModal() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('intro');
  const [baselineSessions, setBaselineSessions] = useState<RawVector[]>([]);
  const [result, setResult] = useState<AuthResult | null>(null);

  const close = () => {
    setOpen(false);
    setPhase('intro');
    setBaselineSessions([]);
    setResult(null);
  };

  const onBaselineComplete = useCallback((sessions: RawVector[]) => {
    // Intentionally NOT saving to localStorage so it's one-time use
    setBaselineSessions(sessions);
    setTimeout(() => setPhase('login'), 300);
  }, []);

  const onAuthResult = useCallback((r: AuthResult) => {
    setResult(r);
    setPhase('results');
  }, []);

  const onReenroll = useCallback(() => {
    // Cannot reenroll, must restart
    close();
  }, []);

  const onRetry = useCallback(() => {
    // One time use, session terminates
    close();
  }, []);

  const stepNum = phase === 'intro' ? 0 : phase === 'baseline' ? 1 : phase === 'login' ? 2 : 3;
  const stepLabel = phase === 'intro' ? 'Instructions' : phase === 'baseline' ? 'Person A: Baseline' : phase === 'login' ? 'Person B: Challenge' : 'Results';

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.625rem 1.25rem', borderRadius: 8,
          border: '1px solid rgba(255,107,53,0.5)', background: 'rgba(255,107,53,0.1)',
          color: '#ff6b35', cursor: 'pointer', fontSize: '0.875rem',
          fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', transition: 'all 0.2s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,107,53,0.18)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,107,53,0.1)')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        Imposter Challenge
      </button>

      {open && (
        <div className="hud-overlay" onClick={e => { if (e.target === e.currentTarget) close(); }}>
          <div className="hud-panel fade-in">
            <div className="hud-header" style={{ borderBottomColor: phase === 'intro' || phase === 'login' ? 'rgba(255,107,53,0.15)' : undefined }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={phase === 'login' ? '#ff6b35' : 'var(--primary)'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  {LOGO_PATHS.map((d, i) => <path key={i} d={d} />)}
                </svg>
                <div>
                  <p style={{ margin: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem', fontWeight: 600, color: phase === 'login' ? '#ff6b35' : undefined }}>
                    finomaly<span style={{ color: phase === 'login' ? '#ff6b35' : 'var(--primary)' }}>.</span> challenge
                  </p>
                  <p style={{ margin: 0, fontSize: '0.68rem', color: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono, monospace' }}>
                    STEP {stepNum}/3 — {stepLabel.toUpperCase()}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {[1, 2, 3].map(n => (
                    <div key={n} style={{
                      width: 24, height: 4, borderRadius: 9999,
                      background: n <= stepNum ? (phase === 'login' ? '#ff6b35' : 'var(--primary)') : 'var(--border)',
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

            {phase === 'intro' && (
              <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }} className="fade-in">
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(255,107,53,0.1)', border: '2px solid rgba(255,107,53,0.3)', margin: '0 auto 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff6b35" strokeWidth="2.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1rem', color: '#ff6b35', margin: '0 0 0.5rem', fontWeight: 600 }}>
                  IMPOSTER CHALLENGE
                </p>
                <p style={{ fontSize: '0.85rem', color: 'var(--muted-foreground)', margin: '0 0 1.5rem', lineHeight: 1.5, textAlign: 'left' }}>
                  This mode proves the 100% intercept rate of our biometric engine. Grab a friend (the Imposter) and follow these instructions:
                </p>
                <ol style={{ fontSize: '0.85rem', color: 'var(--foreground)', margin: '0 0 1.5rem', lineHeight: 1.6, textAlign: 'left', paddingLeft: '1.25rem' }}>
                  <li style={{ marginBottom: '0.5rem' }}><strong>Person A (The Owner)</strong> sets a one-time baseline by typing naturally.</li>
                  <li style={{ marginBottom: '0.5rem' }}><strong>Person B (The Imposter)</strong> sits at the exact same keyboard and tries to mimic the typing rhythm to gain access.</li>
                  <li style={{ marginBottom: '0.5rem' }}>The system will block the imposter live. This session terminates immediately after the test.</li>
                </ol>
                <button
                  onClick={() => setPhase('baseline')}
                  style={{
                    padding: '0.875rem 1.5rem', borderRadius: 8,
                    border: '1px solid #ff6b35',
                    background: 'rgba(255,107,53,0.1)',
                    color: '#ff6b35',
                    cursor: 'pointer', width: '100%',
                    fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85rem', fontWeight: 600,
                    transition: 'all 0.2s',
                  }}
                >
                  Start Challenge (Person A)
                </button>
              </div>
            )}
            
            {phase === 'baseline' && <BaselineSession onComplete={onBaselineComplete} />}
            {phase === 'login' && (
              <div className="fade-in">
                <div style={{ padding: '1rem 1.5rem', background: 'rgba(255,107,53,0.1)', borderBottom: '1px solid rgba(255,107,53,0.2)' }}>
                  <p style={{ margin: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem', color: '#ff6b35', fontWeight: 600 }}>
                    PERSON B: IT'S YOUR TURN
                  </p>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--foreground)' }}>
                    Try to mimic Person A's typing rhythm to bypass the biometric lock.
                  </p>
                </div>
                <LoginSession
                  baselineSessions={baselineSessions}
                  onResult={onAuthResult}
                  onReenroll={onReenroll}
                />
              </div>
            )}
            {phase === 'results' && result && (
              <div className="fade-in">
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
                <div style={{ padding: '1rem 1.5rem', textAlign: 'center' }}>
                  <button
                    onClick={close}
                    style={{
                      padding: '0.75rem 1.5rem', borderRadius: 8,
                      border: '1px solid var(--border)', background: 'transparent',
                      color: 'var(--foreground)', cursor: 'pointer',
                      fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem', fontWeight: 600,
                    }}
                  >
                    End Session
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
