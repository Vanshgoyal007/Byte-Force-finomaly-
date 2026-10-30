'use client';

import { useEffect, useState } from 'react';
import {
  KeystrokeEvent,
  NormVector,
  RawVector,
  Band,
  scoreToBand,
  FeatureDelta,
  FEATURE_NAMES,
  averageRawVectors,
  normaliseVector,
} from './biometrics';

interface Props {
  similarity: number;
  liveVector: RawVector;
  liveNorm: NormVector;
  baselineNorm: NormVector;
  baselineSessions: RawVector[];
  featureDeltas: FeatureDelta[];
  perSession: number[];
  liveKeystrokes: KeystrokeEvent[];
  mode?: 'server' | 'local';
  onRetry: () => void;
  onClose: () => void;
}

type Tab = 'overview' | 'features' | 'math' | 'ai';

// ── Score ring ────────────────────────────────────────────────────────────────
function ScoreRing({ score, band }: { score: number; band: Band }) {
  const [animated, setAnimated] = useState(false);
  useEffect(() => { const t = setTimeout(() => setAnimated(true), 120); return () => clearTimeout(t); }, []);

  const circ = 2 * Math.PI * 60;
  const color = band === 'match' ? '#00f5d4' : band === 'rushed' ? '#ffa500' : '#ff4444';
  const offset = animated ? circ - score * circ : circ;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.875rem' }}>
      <div style={{ position: 'relative', width: 152, height: 152 }}>
        <svg width="152" height="152" viewBox="0 0 152 152">
          <circle cx="76" cy="76" r="60" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="9" />
          <circle
            cx="76" cy="76" r="60" fill="none" stroke={color} strokeWidth="9"
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round" transform="rotate(-90 76 76)"
            style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)', filter: `drop-shadow(0 0 8px ${color}88)` }}
          />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '2rem', fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>
            {Math.round(score * 100)}%
          </span>
          <span style={{ fontSize: '0.65rem', color: 'var(--muted-foreground)', marginTop: 3, fontFamily: 'JetBrains Mono, monospace' }}>MATCH</span>
        </div>
      </div>
      <div style={{ padding: '0.4rem 1.125rem', borderRadius: 9999, border: `1px solid ${color}55`, background: `${color}11`, color, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', fontWeight: 600 }}>
        {band === 'match' ? 'IDENTITY VERIFIED' : band === 'rushed' ? 'RUSHED STATE' : 'ANOMALY DETECTED'}
      </div>
    </div>
  );
}

// ── Feature bar chart ─────────────────────────────────────────────────────────
function FeatureBars({ base, live }: { base: NormVector; live: NormVector }) {
  const [animated, setAnimated] = useState(false);
  useEffect(() => { const t = setTimeout(() => setAnimated(true), 250); return () => clearTimeout(t); }, []);
  const rowH = 42;
  const svgH = rowH * FEATURE_NAMES.length + 10;

  return (
    <svg width="100%" viewBox={`0 0 450 ${svgH}`} style={{ overflow: 'visible' }}>
      {FEATURE_NAMES.map((name, i) => {
        const y = rowH * i + 8;
        const bw = (animated ? base[i] : 0) * 260;
        const lw = (animated ? live[i] : 0) * 260;
        const isAnomaly = Math.abs((live[i] ?? 0) - (base[i] ?? 0)) > 0.25;
        const liveColor = isAnomaly ? '#ff4444' : '#00f5d4';
        return (
          <g key={name}>
            <text x={113} y={y + 12} textAnchor="end" fill="rgba(240,244,245,0.45)" fontSize="10" fontFamily="JetBrains Mono,monospace">{name}</text>
            <rect x={120} y={y} width={bw} height={13} rx="3" fill="rgba(0,245,212,0.22)" style={{ transition: 'width 0.9s ease' }} />
            <text x={120 + bw + 4} y={y + 11} fill="rgba(0,245,212,0.45)" fontSize="8.5" fontFamily="JetBrains Mono,monospace">base</text>
            <rect x={120} y={y + 18} width={lw} height={13} rx="3" fill={liveColor} opacity="0.85" style={{ transition: 'width 0.9s ease' }} />
            <text x={120 + lw + 4} y={y + 29} fill={liveColor} fontSize="8.5" fontFamily="JetBrains Mono,monospace">live</text>
            {isAnomaly && <text x={385} y={y + 12} fill="#ff4444" fontSize="8.5" fontFamily="JetBrains Mono,monospace">HIGH</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ── Keystroke hold-time chart ──────────────────────────────────────────────────
function HoldTimeChart({ keystrokes, avgBase }: { keystrokes: KeystrokeEvent[]; avgBase: number }) {
  const pts = keystrokes.filter(k => k.holdTime > 0 && k.holdTime < 600);
  if (pts.length < 4) return <p style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>Not enough keystroke data.</p>;

  const maxH = Math.max(...pts.map(k => k.holdTime), 2 * avgBase, 200);
  const polyline = pts.map((k, i) => `${((pts.length > 1 ? i / (pts.length - 1) : 0.5) * 440).toFixed(1)},${(80 - k.holdTime / maxH * 80).toFixed(1)}`).join(' ');
  const baseLine = 80 - avgBase / maxH * 80;

  return (
    <div>
      <p style={{ fontSize: '0.72rem', fontFamily: 'JetBrains Mono, monospace', color: 'var(--muted-foreground)', marginBottom: '0.4rem' }}>
        HOLD TIME PER KEYSTROKE (ms) — baseline avg: {Math.round(avgBase)}ms
      </p>
      <svg width="100%" viewBox="0 0 440 102" style={{ overflow: 'visible' }}>
        {[0, 0.25, 0.5, 0.75, 1].map(v => (
          <line key={v} x1={0} y1={80 - 80 * v} x2={440} y2={80 - 80 * v} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        ))}
        <line x1={0} y1={baseLine} x2={440} y2={baseLine} stroke="rgba(0,245,212,0.3)" strokeWidth="1" strokeDasharray="4,3" />
        <text x={444} y={baseLine + 4} fill="rgba(0,245,212,0.4)" fontSize="8.5" fontFamily="JetBrains Mono,monospace">avg</text>
        <polyline points={polyline} fill="none" stroke="#00f5d4" strokeWidth="1.5" strokeLinejoin="round" />
        {pts.map((k, i) => {
          const cx = (pts.length > 1 ? i / (pts.length - 1) : 0.5) * 440;
          const cy = 80 - k.holdTime / maxH * 80;
          return Math.abs(k.holdTime - avgBase) > 0.6 * avgBase
            ? <circle key={i} cx={cx} cy={cy} r="3" fill="#ff6b35" opacity="0.9" />
            : null;
        })}
        <text x={0} y={96} fill="rgba(255,255,255,0.25)" fontSize="8" fontFamily="JetBrains Mono,monospace">key 1</text>
        <text x={440} y={96} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="8" fontFamily="JetBrains Mono,monospace">key {pts.length}</text>
      </svg>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.4rem', fontSize: '0.7rem', fontFamily: 'JetBrains Mono,monospace', color: 'var(--muted-foreground)' }}>
        <span><span style={{ color: '#00f5d4' }}>━</span> Live</span>
        <span><span style={{ color: 'rgba(0,245,212,0.3)' }}>╌</span> Baseline avg</span>
        <span><span style={{ color: '#ff6b35' }}>●</span> Anomaly (&gt;60% dev)</span>
      </div>
    </div>
  );
}

// ── GNN radar ─────────────────────────────────────────────────────────────────
function GNNRadar({ scores }: { scores: number[] }) {
  const nodes = scores.map((s, i) => {
    const angle = (i / scores.length) * 2 * Math.PI - Math.PI / 2;
    return { x: 150 + 60 * Math.cos(angle), y: 85 + 60 * Math.sin(angle), s };
  });

  return (
    <svg width="100%" viewBox="0 0 300 170">
      {nodes.map((n, i) => (
        <g key={i}>
          <line x1={150} y1={85} x2={n.x} y2={n.y} stroke={`rgba(0,245,212,${0.7 * n.s})`} strokeWidth={1 + 2 * n.s} />
          <text x={(150 + n.x) / 2 + 3} y={(85 + n.y) / 2 - 3} fill="rgba(255,255,255,0.3)" fontSize="8.5" fontFamily="JetBrains Mono,monospace">w={n.s.toFixed(2)}</text>
        </g>
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r="20" fill="rgba(13,21,23,0.95)" stroke="rgba(0,245,212,0.4)" strokeWidth="1.5" />
          <text x={n.x} y={n.y - 2} textAnchor="middle" fill="#00f5d4" fontSize="9.5" fontFamily="JetBrains Mono,monospace">S{i + 1}</text>
          <text x={n.x} y={n.y + 9} textAnchor="middle" fill="rgba(240,244,245,0.45)" fontSize="8.5" fontFamily="JetBrains Mono,monospace">{Math.round(n.s * 100)}%</text>
        </g>
      ))}
      <circle cx={150} cy={85} r="24" fill="rgba(0,245,212,0.1)" stroke="#00f5d4" strokeWidth="1.5" />
      <text x={150} y={81} textAnchor="middle" fill="#00f5d4" fontSize="9.5" fontFamily="JetBrains Mono,monospace" fontWeight="bold">LIVE</text>
      <text x={150} y={93} textAnchor="middle" fill="rgba(240,244,245,0.5)" fontSize="8.5" fontFamily="JetBrains Mono,monospace">session</text>
    </svg>
  );
}

// ── Main results view ─────────────────────────────────────────────────────────
export default function ResultsView({
  similarity, liveVector, liveNorm, baselineNorm, baselineSessions,
  featureDeltas, perSession, liveKeystrokes, mode = 'local', onRetry, onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>('overview');

  const band = scoreToBand(similarity);
  const bandColor = band === 'match' ? '#00f5d4' : band === 'rushed' ? '#ffa500' : '#ff4444';

  const baselineRaw = averageRawVectors(baselineSessions);
  const bNorm = normaliseVector(baselineRaw);
  const lNorm = liveNorm;

  // Raw values for display
  const rawPairs = [
    { l: 'WPM',         v: Math.round(liveVector.wpm),            b: Math.round(baselineRaw.wpm),            u: 'wpm' },
    { l: 'HOLD TIME',   v: Math.round(liveVector.avgHoldTime),    b: Math.round(baselineRaw.avgHoldTime),    u: 'ms' },
    { l: 'FLIGHT TIME', v: Math.round(liveVector.avgFlightTime),  b: Math.round(baselineRaw.avgFlightTime),  u: 'ms' },
  ];

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'features', label: 'Features' },
    { id: 'math',     label: 'Math' },
    { id: 'ai',       label: 'Model AI' },
  ];

  return (
    <div>
      {/* Result header */}
      <div style={{
        background: band === 'match' ? 'rgba(0,245,212,0.07)' : band === 'rushed' ? 'rgba(255,165,0,0.07)' : 'rgba(255,68,68,0.07)',
        borderBottom: `1px solid ${bandColor}33`,
        padding: '1rem 1.5rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <p style={{ margin: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.68rem', color: 'var(--muted-foreground)' }}>
              AUTHENTICATION RESULT
            </p>
            {/* Server-verified vs Local mode badge */}
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: '0.65rem',
              fontWeight: 600,
              fontFamily: 'JetBrains Mono, monospace',
              border: mode === 'server' ? '1px solid rgba(0,245,212,0.4)' : '1px solid var(--border)',
              background: mode === 'server' ? 'rgba(0,245,212,0.1)' : 'rgba(255,255,255,0.04)',
              color: mode === 'server' ? '#00f5d4' : 'var(--muted-foreground)',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: mode === 'server' ? '#00f5d4' : '#6b7e83' }} />
              {mode === 'server' ? 'Server-verified' : 'Local mode'}
            </span>
          </div>
          <p style={{ margin: '0.2rem 0 0', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.95rem', fontWeight: 700, color: bandColor }}>
            {band === 'match' ? 'ACCESS GRANTED' : band === 'rushed' ? 'STEPPED UP — FURTHER VERIFICATION NEEDED' : 'ACCESS DENIED — BEHAVIORAL ANOMALY'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={onRetry} style={{ padding: '0.45rem 0.875rem', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--foreground)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'JetBrains Mono, monospace' }}>Try Again</button>
          <button onClick={onClose} style={{ padding: '0.45rem 0.875rem', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: '0.78rem' }}>Close</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 1.5rem', overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '0.75rem 0.875rem', background: 'transparent', border: 'none',
            borderBottom: tab === t.id ? '2px solid #00f5d4' : '2px solid transparent',
            color: tab === t.id ? '#00f5d4' : 'var(--muted-foreground)',
            cursor: 'pointer', fontSize: '0.8rem', fontWeight: tab === t.id ? 600 : 400,
            marginBottom: -1, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ padding: '1.25rem 1.5rem' }}>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <ScoreRing score={similarity} band={band} />

            {/* Quick stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.625rem' }}>
              {rawPairs.map(item => {
                const delta = item.v - item.b;
                const pct = item.b > 0 ? (delta / item.b) * 100 : 0;
                const ok = Math.abs(pct) < 25;
                return (
                  <div key={item.l} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.75rem' }}>
                    <p style={{ margin: 0, fontSize: '0.62rem', fontFamily: 'JetBrains Mono, monospace', color: 'var(--muted-foreground)' }}>{item.l}</p>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '1.1rem', fontWeight: 700 }}>
                      {item.v}<span style={{ fontSize: '0.7rem', color: 'var(--muted-foreground)', marginLeft: 2 }}>{item.u}</span>
                    </p>
                    <p style={{ margin: '0.15rem 0 0', fontSize: '0.68rem', fontFamily: 'JetBrains Mono, monospace', color: ok ? '#00f5d4' : '#ff6b35' }}>
                      {delta >= 0 ? '+' : ''}{Math.round(pct)}% vs baseline
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Keystroke chart */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
              <HoldTimeChart keystrokes={liveKeystrokes} avgBase={baselineRaw.avgHoldTime} />
            </div>
          </div>
        )}

        {/* ── FEATURES ── */}
        {tab === 'features' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <p style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', margin: 0 }}>
              Normalized feature vectors (0–1). Red = deviation &gt;25% from enrolled baseline.
            </p>
            <FeatureBars base={bNorm} live={lNorm} />
            <table className="analysis-table">
              <thead>
                <tr>
                  <th>Feature</th><th>Baseline</th><th>Live</th><th>Delta</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {featureDeltas.map(fd => (
                  <tr key={fd.name}>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem' }}>{fd.name}</td>
                    <td>{Math.round(fd.rawBaseline)}{fd.unit}</td>
                    <td className={fd.isAnomaly ? 'highlight' : ''}>{Math.round(fd.rawLive)}{fd.unit}</td>
                    <td className={fd.isAnomaly ? 'highlight' : ''}>{(100 * Math.abs(fd.delta)).toFixed(1)}%</td>
                    <td><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.68rem', color: fd.isAnomaly ? '#ff4444' : '#00f5d4' }}>{fd.isAnomaly ? 'HIGH LOSS' : 'NORMAL'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── MATH ── */}
        {tab === 'math' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="math-block">
              <p style={{ margin: '0 0 0.4rem', color: 'var(--muted-foreground)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Step 1 — Normalized Vectors</p>
              <p style={{ margin: '0 0 0.3rem', color: 'var(--primary)', fontSize: '0.8rem' }}>Baseline = [{bNorm.map(v => v.toFixed(3)).join(', ')}]</p>
              <p style={{ margin: 0, color: '#f0f4f5', fontSize: '0.8rem' }}>Live    = [{lNorm.map(v => v.toFixed(3)).join(', ')}]</p>
            </div>
            <div className="math-block">
              <p style={{ margin: '0 0 0.4rem', color: 'var(--muted-foreground)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Step 2 — Hybrid Score Formula</p>
              <p style={{ margin: '0 0 0.3rem', color: '#f0f4f5', fontSize: '0.78rem' }}>score = cosine(A, B) × (1 − euclidean_penalty)²</p>
              <p style={{ margin: '0 0 0.3rem', color: '#f0f4f5', fontSize: '0.78rem' }}>euclidean_penalty = √(Σ wᵢ·(aᵢ−bᵢ)² / Σwᵢ)</p>
              <p style={{ margin: 0, color: 'rgba(240,244,245,0.5)', fontSize: '0.72rem' }}>Feature weights: Hold×1.5, Flight×1.2, WPM×1.8, HoldVar×0.8, FlightVar×0.7</p>
            </div>
            <div className="math-block" style={{ border: '1px solid rgba(0,245,212,0.3)' }}>
              <p style={{ margin: '0 0 0.4rem', color: 'var(--muted-foreground)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Step 3 — Final Score</p>
              <p style={{ margin: '0 0 0.3rem', color: '#f0f4f5', fontSize: '0.85rem' }}>
                Identity Match = <span style={{ color: 'var(--primary)', fontWeight: 700 }}>{(similarity * 100).toFixed(2)}%</span>
              </p>
              <p style={{ margin: 0, fontSize: '0.75rem', color: band === 'match' ? '#00f5d4' : band === 'rushed' ? '#ffa500' : '#ff4444' }}>
                Band: {band === 'match' ? '≥85% → MATCH' : band === 'rushed' ? '≥65% → RUSHED' : '<65% → ANOMALY'}
              </p>
            </div>

            {/* Per-session similarities */}
            <div>
              <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.68rem', color: 'var(--muted-foreground)', marginBottom: '0.625rem', textTransform: 'uppercase' }}>
                Per-Baseline-Session Similarity
              </p>
              {perSession.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.68rem', color: 'var(--muted-foreground)', minWidth: 28 }}>S{i + 1}</span>
                  <div className="feature-bar-track">
                    <div style={{ height: '100%', background: `rgba(0,245,212,${0.4 + 0.6 * s})`, borderRadius: 9999, width: `${100 * s}%`, transition: 'width 0.8s ease' }} />
                  </div>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.68rem', color: '#00f5d4', minWidth: 42, textAlign: 'right' }}>{(100 * s).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── AI ── */}
        {tab === 'ai' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.68rem', color: 'var(--muted-foreground)', textTransform: 'uppercase', marginBottom: '0.625rem' }}>
                Autoencoder Reconstruction Error
              </p>
              <p style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', marginBottom: '0.875rem' }}>
                Features with high reconstruction loss drove the anomaly signal. The autoencoder was trained on your baseline session.
              </p>
              {featureDeltas.map(fd => (
                <div key={fd.name} style={{ marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                    <span style={{ fontSize: '0.78rem', color: fd.isAnomaly ? '#ff6b35' : 'var(--foreground)' }}>{fd.name}</span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.68rem', color: fd.isAnomaly ? '#ff6b35' : 'var(--muted-foreground)' }}>
                      {fd.isAnomaly ? 'HIGH LOSS' : 'LOW LOSS'} — {(100 * Math.abs(fd.delta)).toFixed(1)}%
                    </span>
                  </div>
                  <div className="feature-bar-track" style={{ height: 9 }}>
                    <div style={{ height: '100%', background: fd.isAnomaly ? '#ff4444' : '#00f5d4', borderRadius: 9999, width: `${Math.min(100 * Math.abs(fd.delta) * 3, 100)}%`, transition: 'width 0.8s ease' }} />
                  </div>
                </div>
              ))}
            </div>

            <div>
              <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.68rem', color: 'var(--muted-foreground)', textTransform: 'uppercase', marginBottom: '0.625rem' }}>
                GNN Neighbor Context
              </p>
              <p style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', marginBottom: '0.625rem' }}>
                Each baseline session (S1–S{baselineSessions.length}) is a trusted node. Edge weight = similarity to current session.
              </p>
              <GNNRadar scores={perSession} />
              <div className="math-block" style={{ marginTop: '0.625rem' }}>
                <p style={{ margin: 0, fontSize: '0.8rem' }}>
                  Risk Score = 1 − avg(weights) = 1 − {similarity.toFixed(3)} = {' '}
                  <span style={{ color: similarity < 0.65 ? '#ff4444' : '#00f5d4' }}>{(1 - similarity).toFixed(3)}</span>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
