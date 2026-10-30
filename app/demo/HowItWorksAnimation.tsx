'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/* ─────────────────────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────────────────────── */
type Stage =
  | 'idle' | 'owner_typing' | 'warp_enter' | 'warp_tunnel'
  | 'math_baseline' | 'baseline_set'
  | 'mule_typing' | 'mule_warp_enter' | 'mule_warp_tunnel'
  | 'math_mule' | 'mule_detected' | 'done';

/* ─────────────────────────────────────────────────────────────────────────────
   BIOMETRICS (mirrors biometrics.ts exactly)
───────────────────────────────────────────────────────────────────────────── */
const WEIGHTS = [1.5, 1.2, 1.8, 0.8, 0.7];
const WEIGHT_SUM = WEIGHTS.reduce((a, b) => a + b, 0); // 6.0
const BOUNDS = {
  hold:      { min: 40,  max: 250 },
  flight:    { min: 20,  max: 400 },
  wpm:       { min: 15,  max: 150 },
  holdVar:   { min: 0,   max: 120 },
  flightVar: { min: 0,   max: 200 },
};
function norm(v: number, k: keyof typeof BOUNDS) {
  const { min, max } = BOUNDS[k];
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}
const BL = { hold: 180, flight: 138, wpm: 58, holdVar: 34, flightVar: 36 };
const ML = { hold: 121, flight: 94,  wpm: 87, holdVar: 62, flightVar: 78 };

const baseNorm = [norm(BL.hold,'hold'), norm(BL.flight,'flight'), norm(BL.wpm,'wpm'), norm(BL.holdVar,'holdVar'), norm(BL.flightVar,'flightVar')];
const muleNorm = [norm(ML.hold,'hold'), norm(ML.flight,'flight'), norm(ML.wpm,'wpm'), norm(ML.holdVar,'holdVar'), norm(ML.flightVar,'flightVar')];

function wDot(a: number[], b: number[]) { return a.reduce((s,ai,i)=>s+ai*b[i]*WEIGHTS[i],0); }
function wMag(v: number[]) { return Math.sqrt(v.reduce((s,vi,i)=>s+vi*vi*WEIGHTS[i],0)); }
function cosine(a: number[], b: number[]) {
  const mA=wMag(a),mB=wMag(b);
  return (!mA||!mB)?0:Math.min(1,wDot(a,b)/(mA*mB));
}
function penalty(a: number[], b: number[]) {
  const wSSD=a.reduce((s,ai,i)=>s+WEIGHTS[i]*(ai-b[i])**2,0);
  return Math.min(1,Math.sqrt(wSSD/WEIGHT_SUM));
}
const COS  = cosine(baseNorm, muleNorm);
const PEN  = penalty(baseNorm, muleNorm);
const SCORE = Math.round(COS * (1-PEN)**2 * 100);

/* ─────────────────────────────────────────────────────────────────────────────
   WEB AUDIO — pure procedural synth, no files needed
───────────────────────────────────────────────────────────────────────────── */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  private getCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.28;
      this.masterGain.connect(this.ctx.destination);
    }
    return { ctx: this.ctx, master: this.masterGain! };
  }

  keyClick() {
    try {
      const { ctx, master } = this.getCtx();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.04, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.008));
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = 3200;
      filt.Q.value = 0.8;
      src.connect(filt);
      filt.connect(master);
      src.start();
    } catch {}
  }

  warpStart(color: 'green' | 'red') {
    try {
      const { ctx, master } = this.getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(color === 'green' ? 80 : 60, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(color === 'green' ? 800 : 400, ctx.currentTime + 0.8);
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + 0.9);
    } catch {}
  }

  mathReveal() {
    try {
      const { ctx, master } = this.getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880 + Math.random() * 440;
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {}
  }

  success() {
    try {
      const { ctx, master } = this.getCtx();
      const freqs = [523, 659, 784, 1047];
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        const t = ctx.currentTime + i * 0.12;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.18, t + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 0.5);
      });
    } catch {}
  }

  alert() {
    try {
      const { ctx, master } = this.getCtx();
      const freqs = [220, 165];
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = f;
        const t = ctx.currentTime + i * 0.22;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.15, t + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 0.5);
      });
    } catch {}
  }

  ambientHum(color: 'green' | 'red', durationMs: number) {
    try {
      const { ctx, master } = this.getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = color === 'green' ? 55 : 45;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.06, ctx.currentTime + durationMs / 1000 - 0.3);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + durationMs / 1000);
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + durationMs / 1000);
    } catch {}
  }
}

const sfx = new SoundEngine();

/* ─────────────────────────────────────────────────────────────────────────────
   QWERTY KEYBOARD (CSS 3D, no person)
───────────────────────────────────────────────────────────────────────────── */
const ROWS = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M'],
];
const ALL_KEYS = ROWS.flat();

function Keyboard3D({ activeKey, accent }: { activeKey: string | null; accent: string }) {
  return (
    <div style={{ perspective: 700, perspectiveOrigin: '50% 5%' }}>
      <div style={{
        transform: 'rotateX(34deg)',
        transformStyle: 'preserve-3d',
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 5,
        padding: '20px 26px 24px',
        background: 'linear-gradient(160deg, #141a1d 0%, #0b0f10 100%)',
        borderRadius: 12,
        border: '1px solid #1e2c30',
        boxShadow: `0 60px 100px rgba(0,0,0,0.95), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 60px ${accent}18`,
      }}>
        {ROWS.map((row, ri) => (
          <div key={ri} style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
            {row.map(k => {
              const hot = activeKey === k;
              return (
                <div key={k} style={{
                  width: 36, height: 36, borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.58rem', fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 700, letterSpacing: '0.04em',
                  background: hot
                    ? `linear-gradient(160deg, ${accent}30, ${accent}18)`
                    : 'linear-gradient(160deg, #1f272a, #151c1f)',
                  color: hot ? accent : '#5a7a82',
                  border: hot ? `1px solid ${accent}80` : '1px solid #1e2c30',
                  boxShadow: hot
                    ? `0 0 18px ${accent}60, 0 0 6px ${accent}40, 0 5px 0 #060a0b`
                    : '0 5px 0 #060a0b, inset 0 1px 0 rgba(255,255,255,0.04)',
                  transform: hot ? 'translateY(4px)' : 'translateY(0)',
                  transition: 'all 0.07s ease',
                }}>
                  {k}
                </div>
              );
            })}
          </div>
        ))}
        {/* Number row accent */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginTop: 2 }}>
          <div style={{
            width: 170, height: 26, borderRadius: 6,
            background: 'linear-gradient(160deg, #1f272a, #151c1f)',
            border: '1px solid #1e2c30',
            boxShadow: '0 5px 0 #060a0b, inset 0 1px 0 rgba(255,255,255,0.04)',
          }}/>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   TYPING SCENE (no person — just label + keyboard + telemetry readouts)
───────────────────────────────────────────────────────────────────────────── */
function TypingScene({ label, accent, activeKey, data, zooming }: {
  label: 'USER' | 'MULE';
  accent: string;
  activeKey: string | null;
  data: typeof BL;
  zooming: boolean;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(p => p + 1), 90);
    return () => clearInterval(t);
  }, []);

  // Jitter the readouts a tiny bit to simulate live capture
  const jitter = (base: number, range: number) => (base + (Math.sin(tick * 0.7 + base) * range)).toFixed(1);

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12,
      transform: zooming ? 'scale(8) translateY(18%)' : 'scale(1)',
      transition: zooming ? 'transform 0.32s cubic-bezier(0.4,0,1,1)' : 'none',
    }}>
      {/* Session badge */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem',
        letterSpacing: '0.18em', fontWeight: 700,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: accent, boxShadow: `0 0 12px ${accent}`,
          display: 'inline-block', animation: 'fp-breathe 1.2s ease infinite',
        }}/>
        <span style={{ color: accent }}>{label}</span>
        <span style={{ color: '#2e4048', margin: '0 6px' }}>|</span>
        <span style={{ color: '#4a6069', fontWeight: 400 }}>SESSION ACTIVE</span>
        <span style={{ color: '#2e4048', margin: '0 6px' }}>|</span>
        <span style={{ color: '#4a6069', fontWeight: 400 }}>TELEMETRY CAPTURE</span>
      </div>

      {/* Live telemetry strip */}
      <div style={{
        display: 'flex', gap: 14,
        fontFamily: 'JetBrains Mono, monospace', fontSize: '0.58rem',
        color: '#3a5055', letterSpacing: '0.06em', marginBottom: 4,
      }}>
        {[
          { k: 'WPM',      v: jitter(data.wpm,      2.4) },
          { k: 'HOLD',     v: jitter(data.hold,      3.2) + ' ms' },
          { k: 'FLIGHT',   v: jitter(data.flight,    2.8) + ' ms' },
          { k: 'σ-HOLD',   v: jitter(data.holdVar,   1.6) + ' ms' },
          { k: 'σ-FLIGHT', v: jitter(data.flightVar, 1.4) + ' ms' },
        ].map(({ k, v }) => (
          <span key={k}>
            <span style={{ color: '#263337' }}>{k}:</span>{' '}
            <span style={{ color: accent + 'bb' }}>{v}</span>
          </span>
        ))}
      </div>

      <Keyboard3D activeKey={activeKey} accent={accent} />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
        fontFamily: 'JetBrains Mono, monospace', fontSize: '0.65rem',
        color: accent + '90', letterSpacing: '0.14em',
        animation: 'fp-breathe 1.8s ease infinite',
      }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        CAPTURING BEHAVIORAL TELEMETRY…
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   WARP TUNNEL
───────────────────────────────────────────────────────────────────────────── */
function WarpTunnel({ accent }: { accent: string }) {
  const lines = Array.from({ length: 80 }, (_, i) => ({
    id: i,
    angle: (i / 80) * 360,
    len: 20 + (i % 7) * 14,
    delay: (i % 12) * 0.05,
    opacity: 0.15 + (i % 5) * 0.17,
    speed: 0.4 + (i % 4) * 0.12,
  }));
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#010203', overflow: 'hidden' }}>
      <style>{`
        @keyframes wline{0%{transform:translateZ(-300px) scale(0.03);opacity:0}15%{opacity:1}100%{transform:translateZ(900px) scale(6);opacity:0}}
      `}</style>
      <div style={{ position: 'absolute', inset: 0, perspective: '280px', perspectiveOrigin: '50% 50%' }}>
        {lines.map(l => (
          <div key={l.id} style={{
            position: 'absolute', left: '50%', top: '50%',
            width: 1.5, height: l.len,
            background: `linear-gradient(to bottom, transparent, ${accent})`,
            transformOrigin: '50% 0%',
            transform: `rotate(${l.angle}deg) translateY(-50vh)`,
            animation: `wline ${l.speed}s linear infinite`,
            animationDelay: `${l.delay}s`,
            opacity: l.opacity,
            boxShadow: `0 0 6px ${accent}`,
          }}/>
        ))}
      </div>
      {/* radial glow */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `radial-gradient(ellipse 60% 60% at 50% 50%, ${accent}1a 0%, transparent 70%)`,
      }}/>
      {/* center ring */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 100, height: 100, borderRadius: '50%',
        transform: 'translate(-50%,-50%)',
        border: `1.5px solid ${accent}80`,
        boxShadow: `0 0 40px ${accent}60, inset 0 0 30px ${accent}30`,
        animation: 'wline 1s linear infinite',
      }}/>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MATH SCREEN — two column layout, slowed down
───────────────────────────────────────────────────────────────────────────── */
interface MLine {
  tag: 'heading' | 'formula' | 'calc' | 'result' | 'divider';
  label?: string;
  value?: string;
  comment?: string;
}

const baselineLines: MLine[] = [
  { tag: 'heading', label: '01 // RAW TELEMETRY CAPTURE' },
  { tag: 'calc',    label: 'WPM (typing speed)',        value: '58.0  wpm' },
  { tag: 'calc',    label: 'μ Hold Time (dwell)',       value: '180.0 ms' },
  { tag: 'calc',    label: 'μ Flight Time (inter-key)', value: '138.0 ms' },
  { tag: 'calc',    label: 'σ Hold Variance',           value: '34.0  ms' },
  { tag: 'calc',    label: 'σ Flight Variance',         value: '36.0  ms' },
  { tag: 'divider' },
  { tag: 'heading', label: '02 // MIN–MAX NORMALISATION   norm(x) = (x − min) / (max − min)' },
  { tag: 'formula', label: 'norm(Hold)',      value: '(180 − 40)  / (250 − 40)',  comment: '= 0.6667' },
  { tag: 'formula', label: 'norm(Flight)',    value: '(138 − 20)  / (400 − 20)',  comment: '= 0.3105' },
  { tag: 'formula', label: 'norm(WPM)',       value: '(58  − 15)  / (150 − 15)',  comment: '= 0.3185' },
  { tag: 'formula', label: 'norm(σ-Hold)',    value: '(34  − 0)   / (120 − 0)',   comment: '= 0.2833' },
  { tag: 'formula', label: 'norm(σ-Flight)',  value: '(36  − 0)   / (200 − 0)',   comment: '= 0.1800' },
  { tag: 'divider' },
  { tag: 'heading', label: '03 // FEATURE WEIGHT VECTOR' },
  { tag: 'calc',    label: 'Weights [Hold, Flight, WPM, σH, σF]', value: '[ 1.5,   1.2,   1.8,   0.8,   0.7 ]' },
  { tag: 'calc',    label: 'Σ weights',    value: '= 6.0' },
  { tag: 'formula', label: 'B = norm × w', value: '[0.667×1.5, 0.311×1.2, 0.319×1.8, 0.283×0.8, 0.180×0.7]' },
  { tag: 'result',  label: 'B (centroid)', value: '[ 1.001,   0.373,   0.574,   0.226,   0.126 ]' },
  { tag: 'divider' },
  { tag: 'result',  label: 'BASELINE CENTROID STORED — IDENTITY LOCKED', value: '' },
];

const muleLines: MLine[] = [
  { tag: 'heading', label: '01 // LIVE SESSION CAPTURE — IMPOSTER' },
  { tag: 'calc',    label: 'WPM (typing speed)',        value: '87.0  wpm',  comment: '↑ +29 wpm vs baseline' },
  { tag: 'calc',    label: 'μ Hold Time',               value: '121.0 ms',   comment: '↓ −59 ms vs baseline' },
  { tag: 'calc',    label: 'μ Flight Time',             value: '94.0  ms',   comment: '↓ −44 ms vs baseline' },
  { tag: 'calc',    label: 'σ Hold Variance',           value: '62.0  ms',   comment: '↑ +28 ms vs baseline' },
  { tag: 'calc',    label: 'σ Flight Variance',         value: '78.0  ms',   comment: '↑ +42 ms vs baseline' },
  { tag: 'divider' },
  { tag: 'heading', label: '02 // NORMALISED LIVE VECTOR' },
  { tag: 'result',  label: 'L', value: '[ 0.386,   0.197,   0.533,   0.517,   0.390 ]' },
  { tag: 'divider' },
  { tag: 'heading', label: '03 // COSINE ALIGNMENT — shape match' },
  { tag: 'formula', label: 'Alignment', value: 'Σ(wᵢ · Bᵢ · Lᵢ) / ( |B|w · |L|w )' },
  { tag: 'result',  label: 'Alignment', value: `${COS.toFixed(4)}` },
  { tag: 'divider' },
  { tag: 'heading', label: '04 // EUCLIDEAN PENALTY — magnitude gap' },
  { tag: 'formula', label: 'P', value: 'P = √[ Σ wᵢ(Bᵢ − Lᵢ)² / Σ wᵢ ]' },
  { tag: 'formula', label: 'P', value: `√[ Σ wᵢ × Δᵢ² ] / √${WEIGHT_SUM.toFixed(1)}` },
  { tag: 'result',  label: 'P (penalty)', value: `${PEN.toFixed(4)}` },
  { tag: 'divider' },
  { tag: 'heading', label: '05 // FINAL HYBRID MATCH SCORE' },
  { tag: 'formula', label: 'Score', value: 'Alignment × (1 − P)²' },
  { tag: 'formula', label: 'Score', value: `${COS.toFixed(4)} × (1 − ${PEN.toFixed(4)})²` },
  { tag: 'result',  label: 'ALERT: FINAL SCORE', value: `${SCORE}%  ←  THRESHOLD 65%  →  ANOMALY` },
];

function MathScreen({ lines, visible, accent, title }: {
  lines: MLine[]; visible: number; accent: string; title: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visible]);

  return (
    <div style={{
      position: 'absolute', inset: 0, background: '#010305',
      fontFamily: 'JetBrains Mono, monospace', display: 'flex', flexDirection: 'column',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 24px',
        borderBottom: `1px solid ${accent}22`, flexShrink: 0,
        background: `linear-gradient(90deg, ${accent}08, transparent)`,
      }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: accent, boxShadow: `0 0 10px ${accent}`, animation: 'fp-breathe 1s ease infinite' }}/>
        <span style={{ fontSize: '0.65rem', letterSpacing: '0.18em', color: accent, fontWeight: 700 }}>
          FINOMALY ENGINE v3.0 // {title}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
          {['HYBRID-SIM', 'EUCLID-PENALTY', 'COSINE-ALIGN'].map(tag => (
            <span key={tag} style={{ fontSize: '0.5rem', color: accent + '55', letterSpacing: '0.12em' }}>{tag}</span>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '18px 28px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {lines.slice(0, visible).map((line, i) => {
          if (line.tag === 'divider') return (
            <div key={i} style={{ height: 1, background: `${accent}14`, margin: '10px 0' }}/>
          );
          if (line.tag === 'heading') return (
            <div key={i} className="fade-in" style={{ margin: '12px 0 6px', fontSize: '0.6rem', letterSpacing: '0.16em', color: accent + '80', fontWeight: 700 }}>
              {line.label}
            </div>
          );
          if (line.tag === 'formula') return (
            <div key={i} className="fade-in" style={{ display: 'flex', gap: 0, alignItems: 'baseline', paddingLeft: 16 }}>
              <span style={{ fontSize: '0.62rem', color: '#2e4a52', minWidth: 180, flexShrink: 0 }}>{line.label}</span>
              <span style={{ fontSize: '0.62rem', color: '#7ab' }}>=  </span>
              <span style={{ fontSize: '0.62rem', color: '#9ecfd8' }}>{line.value}</span>
              {line.comment && <span style={{ marginLeft: 16, fontSize: '0.55rem', color: accent + '60' }}>{line.comment}</span>}
            </div>
          );
          if (line.tag === 'calc') return (
            <div key={i} className="fade-in" style={{ display: 'flex', gap: 0, alignItems: 'baseline', paddingLeft: 16 }}>
              <span style={{ fontSize: '0.62rem', color: '#2e4a52', minWidth: 260, flexShrink: 0 }}>{line.label}</span>
              <span style={{ fontSize: '0.68rem', color: '#c8d8dc', letterSpacing: '0.04em' }}>{line.value}</span>
              {line.comment && <span style={{ marginLeft: 16, fontSize: '0.55rem', color: accent + '60' }}>{line.comment}</span>}
            </div>
          );
          if (line.tag === 'result') return (
            <div key={i} className="fade-in" style={{
              margin: '6px 0', padding: '8px 16px', borderRadius: 8,
              background: `${accent}0d`, border: `1px solid ${accent}28`,
              display: 'flex', gap: 16, alignItems: 'center',
            }}>
              <span style={{ fontSize: '0.6rem', color: accent + '70', minWidth: 160, flexShrink: 0 }}>{line.label}</span>
              <span style={{ fontSize: '0.78rem', color: accent, fontWeight: 700, letterSpacing: '0.06em', textShadow: `0 0 20px ${accent}80` }}>{line.value}</span>
            </div>
          );
          return null;
        })}
      </div>

      {/* Scanlines */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 31px, rgba(255,255,255,0.008) 32px)' }}/>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   RESULT SCREEN
───────────────────────────────────────────────────────────────────────────── */
function ResultScreen({ type, onReplay, onClose }: { type: 'baseline' | 'mule'; onReplay?: () => void; onClose: () => void }) {
  const isBase = type === 'baseline';
  const accent = isBase ? '#00f5d4' : '#ff6b35';
  const label  = isBase ? 'BASELINE LOCKED' : 'MULE DETECTED';
  const sub    = isBase
    ? 'BEHAVIORAL CENTROID STORED // OWNER PROFILE ACTIVE'
    : `MATCH SCORE: ${SCORE}%  //  THRESHOLD: 65%  //  ACCESS DENIED`;
  const Icon = isBase
    ? () => <path d="M20 6 9 17l-5-5"/>
    : () => <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>;

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 40,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 28, background: '#010203',
    }}>
      {/* Radial glow */}
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 50% 50% at 50% 50%, ${accent}12, transparent)`, pointerEvents: 'none' }}/>

      <div style={{ width: 90, height: 90, borderRadius: '50%', background: `${accent}12`, border: `2px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 60px ${accent}50`, animation: isBase ? 'fp-breathe 2s ease infinite' : 'fp-breathe 0.7s ease infinite' }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <Icon />
        </svg>
      </div>

      <div style={{ textAlign: 'center', zIndex: 1 }}>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '2.2rem', fontWeight: 800, color: accent, margin: 0, letterSpacing: '0.06em', textShadow: `0 0 50px ${accent}70` }}>
          {label}
        </p>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem', color: '#3a5a62', margin: '12px 0 0', letterSpacing: '0.12em' }}>
          {sub}
        </p>
      </div>

      {/* Feature vector mini display */}
      <div style={{ display: 'flex', gap: 8, zIndex: 1 }}>
        {(isBase
          ? [['Hold','0.667'],['Flight','0.311'],['WPM','0.319'],['σH','0.283'],['σF','0.180']]
          : [['Hold','0.386'],['Flight','0.197'],['WPM','0.533'],['σH','0.517'],['σF','0.390']]
        ).map(([k, v]) => (
          <div key={k} style={{ textAlign: 'center', padding: '8px 14px', background: `${accent}0a`, border: `1px solid ${accent}22`, borderRadius: 8, fontFamily: 'JetBrains Mono, monospace' }}>
            <div style={{ fontSize: '0.5rem', color: '#3a5a62', letterSpacing: '0.1em', marginBottom: 4 }}>{k}</div>
            <div style={{ fontSize: '0.72rem', color: accent, fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>

      {type === 'mule' && onReplay && (
        <div className="fade-in" style={{ display: 'flex', gap: 12, zIndex: 1 }}>
          <button onClick={onReplay} style={{ background: `${accent}15`, border: `1px solid ${accent}50`, color: accent, padding: '8px 22px', borderRadius: 8, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem', letterSpacing: '0.1em' }}>
            ↺  REPLAY
          </button>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #1e2c30', color: '#3a5a62', padding: '8px 22px', borderRadius: 8, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem', letterSpacing: '0.1em' }}>
            CLOSE
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────────────────────── */
export default function HowItWorksAnimation() {
  const [open, setOpen]           = useState(false);
  const [stage, setStage]         = useState<Stage>('idle');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [mathVis, setMathVis]     = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clr = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };
  const clearAll = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  /* Key ticker */
  useEffect(() => {
    if (stage !== 'owner_typing' && stage !== 'mule_typing') { setActiveKey(null); return; }
    let i = 0;
    const t = setInterval(() => {
      const k = ALL_KEYS[Math.floor(Math.random() * ALL_KEYS.length)];
      setActiveKey(k);
      sfx.keyClick();
      i++;
    }, 130);
    return () => clearInterval(t);
  }, [stage]);

  /* Math ticker — 500ms per line (slow & readable) */
  useEffect(() => {
    if (stage !== 'math_baseline' && stage !== 'math_mule') { setMathVis(0); return; }
    const lines = stage === 'math_baseline' ? baselineLines : muleLines;
    let i = 1;
    const t = setInterval(() => {
      sfx.mathReveal();
      setMathVis(i);
      i++;
      if (i > lines.length) clearInterval(t);
    }, 500); // 500ms — slow and legible
    return () => clearInterval(t);
  }, [stage]);

  const startAnimation = useCallback(() => {
    clearAll();
    setStage('owner_typing');
    sfx.ambientHum('green', 3000);

    // Owner types 3s
    clr(3000, () => { setStage('warp_enter'); sfx.warpStart('green'); });
    clr(3320, () => setStage('warp_tunnel'));
    // Tunnel 1.6s
    clr(4900, () => setStage('math_baseline'));
    // Baseline math: 21 lines × 500ms = 10.5s
    clr(15600, () => { setStage('baseline_set'); sfx.success(); });
    // Baseline set: 3.5s
    clr(19100, () => { setStage('mule_typing'); sfx.ambientHum('red', 3000); });
    // Mule types 3s
    clr(22100, () => { setStage('mule_warp_enter'); sfx.warpStart('red'); });
    clr(22420, () => setStage('mule_warp_tunnel'));
    // Tunnel 1.6s
    clr(24000, () => setStage('math_mule'));
    // Mule math: 24 lines × 500ms = 12s
    clr(36200, () => { setStage('mule_detected'); sfx.alert(); });
    clr(39500, () => setStage('done'));
  }, []);

  function handleOpen() {
    setOpen(true);
    setTimeout(startAnimation, 200);
  }
  function handleClose() {
    clearAll();
    setOpen(false);
    setStage('idle');
    setMathVis(0);
  }
  function handleReplay() {
    setStage('idle');
    setMathVis(0);
    setTimeout(startAnimation, 150);
  }

  const accent = ['mule_typing','mule_warp_enter','mule_warp_tunnel','math_mule','mule_detected','done'].includes(stage)
    ? '#ff6b35' : '#00f5d4';

  return (
    <>
      <button
        onClick={handleOpen}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 14,
          padding: '0.85rem 1.4rem',
          borderRadius: 14,
          border: '1px solid rgba(0, 245, 212, 0.35)',
          background: 'rgba(8, 20, 23, 0.85)',
          backdropFilter: 'blur(12px)',
          color: '#ffffff',
          cursor: 'pointer',
          boxShadow: '0 8px 32px rgba(0, 245, 212, 0.12)',
          transition: 'all 0.25s ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'rgba(0, 245, 212, 0.7)';
          e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 245, 212, 0.25)';
          e.currentTarget.style.transform = 'translateY(-2px)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'rgba(0, 245, 212, 0.35)';
          e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 245, 212, 0.12)';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        <span style={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          background: 'rgba(0, 245, 212, 0.15)',
          border: '1.5px solid #00f5d4',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#00f5d4',
          flexShrink: 0,
          boxShadow: '0 0 12px rgba(0, 245, 212, 0.3)',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#00f5d4" stroke="#00f5d4" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </span>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#ffffff', letterSpacing: '-0.01em' }}>
            See how it actually works
          </div>
          <div style={{ fontSize: '0.75rem', color: '#00f5d4', fontFamily: 'JetBrains Mono, monospace', marginTop: '2px', display: 'flex', alignItems: 'center', gap: 4 }}>
            Interactive 30-sec simulation
          </div>
        </div>
      </button>

      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.97)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* HUD top bar */}
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100002, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', background: 'rgba(1,3,5,0.9)', borderBottom: `1px solid ${accent}18`, backdropFilter: 'blur(8px)', transition: 'border-color 0.6s' }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', color: accent, letterSpacing: '0.18em', animation: 'fp-breathe 3s ease infinite' }}>
              FINOMALY // BEHAVIORAL BIOMETRIC ENGINE // WALKTHROUGH
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.55rem', color: '#2e4048', letterSpacing: '0.12em' }}>
                {stage.replace(/_/g, ' ').toUpperCase()}
              </span>
              <button onClick={handleClose} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#5a7a82', cursor: 'pointer', padding: '4px 12px', borderRadius: 6, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem', letterSpacing: '0.1em' }}>
                ESC
              </button>
            </div>
          </div>

          {/* Main scene container */}
          <div style={{
            width: '96vw', maxWidth: 1000, height: '78vh', maxHeight: 640,
            position: 'relative', overflow: 'hidden',
            borderRadius: 14, border: `1px solid ${accent}22`,
            background: '#010305',
            boxShadow: `0 0 100px ${accent}14, 0 40px 80px rgba(0,0,0,0.9)`,
            transition: 'border-color 0.6s',
            marginTop: 44,
          }}>

            {/* ─── OWNER TYPING ─── */}
            {(stage === 'owner_typing' || stage === 'warp_enter') && (
              <TypingScene label="USER" accent="#00f5d4" activeKey={activeKey} data={BL} zooming={stage === 'warp_enter'} />
            )}

            {/* ─── WARP (green) ─── */}
            {stage === 'warp_tunnel' && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 20 }}>
                <WarpTunnel accent="#00f5d4" />
                <div style={{ position: 'absolute', bottom: 50, left: 0, right: 0, textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', color: '#00f5d430', letterSpacing: '0.24em', animation: 'fp-breathe 0.4s ease infinite' }}>
                  ENTERING BIOMETRIC CORE…
                </div>
              </div>
            )}

            {/* ─── MATH BASELINE ─── */}
            {stage === 'math_baseline' && (
              <MathScreen lines={baselineLines} visible={mathVis} accent="#00f5d4" title="BASELINE ENROLLMENT" />
            )}

            {/* ─── BASELINE SET ─── */}
            {(stage === 'baseline_set') && (
              <ResultScreen type="baseline" onClose={handleClose} />
            )}

            {/* ─── MULE TYPING ─── */}
            {(stage === 'mule_typing' || stage === 'mule_warp_enter') && (
              <>
                {stage === 'mule_typing' && (
                  <div style={{ position: 'absolute', top: 56, left: 0, right: 0, zIndex: 20, display: 'flex', justifyContent: 'center' }}>
                    <div className="fade-in" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.58rem', color: '#ff6b35', background: 'rgba(255,107,53,0.08)', border: '1px solid rgba(255,107,53,0.25)', padding: '5px 18px', borderRadius: 99, letterSpacing: '0.14em' }}>
                      NEW SESSION // COMPARING AGAINST STORED BASELINE
                    </div>
                  </div>
                )}
                <TypingScene label="MULE" accent="#ff6b35" activeKey={activeKey} data={ML} zooming={stage === 'mule_warp_enter'} />
              </>
            )}

            {/* ─── WARP (red) ─── */}
            {stage === 'mule_warp_tunnel' && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 20 }}>
                <WarpTunnel accent="#ff6b35" />
                <div style={{ position: 'absolute', bottom: 50, left: 0, right: 0, textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', color: '#ff6b3530', letterSpacing: '0.24em', animation: 'fp-breathe 0.4s ease infinite' }}>
                  RUNNING HYBRID SIMILARITY ENGINE…
                </div>
              </div>
            )}

            {/* ─── MATH MULE ─── */}
            {stage === 'math_mule' && (
              <MathScreen lines={muleLines} visible={mathVis} accent="#ff6b35" title="LIVE SESSION ANALYSIS" />
            )}

            {/* ─── MULE DETECTED / DONE ─── */}
            {(stage === 'mule_detected' || stage === 'done') && (
              <ResultScreen type="mule" onReplay={stage === 'done' ? handleReplay : undefined} onClose={handleClose} />
            )}

            {/* ─── Corner brackets ─── */}
            {(['tl','tr','bl','br'] as const).map(p => (
              <div key={p} style={{
                position: 'absolute', width: 20, height: 20, zIndex: 90, pointerEvents: 'none',
                top: p[0]==='t' ? 12 : undefined, bottom: p[0]==='b' ? 12 : undefined,
                left: p[1]==='l' ? 12 : undefined, right: p[1]==='r' ? 12 : undefined,
                borderTop: p[0]==='t' ? `1.5px solid ${accent}50` : undefined,
                borderBottom: p[0]==='b' ? `1.5px solid ${accent}50` : undefined,
                borderLeft: p[1]==='l' ? `1.5px solid ${accent}50` : undefined,
                borderRight: p[1]==='r' ? `1.5px solid ${accent}50` : undefined,
                transition: 'border-color 0.6s',
              }}/>
            ))}

            {/* Scanlines */}
            <div style={{ position: 'absolute', inset: 0, zIndex: 85, pointerEvents: 'none', backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.01) 4px)' }}/>
          </div>
        </div>
      )}
    </>
  );
}
