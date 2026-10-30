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
  scoreToBand,
  wordCount,
  FEATURE_NAMES,
} from './biometrics';
import { enrollSessionApi, verifySessionApi } from '@/lib/apiClient';
import FlatRadarChart from '@/components/FlatRadarChart';
import Footer from '@/components/Footer';
import RhythmStrip from '@/components/RhythmStrip';

const STORAGE_KEY = 'finomaly_baseline_v4';

const BASELINE_PASSAGES = [
  'The internet was originally developed as a decentralized communication network. Over several decades it evolved from a small academic experiment into a global infrastructure connecting billions of people across every nation on the planet.',
  'Machine learning enables computers to learn patterns from data without being explicitly programmed. Algorithms trained on large datasets can recognize images, translate languages, and detect fraud in financial transactions.',
  'Behavioral biometrics studies uniquely identifying patterns in human activity. Unlike physical biometrics such as fingerprints, behavioral signals like typing rhythm evolve continuously and remain uniquely your own.',
];

const VERIFY_PASSPHRASE = 'behavioral authentication protects accounts where passwords cannot reach';

const MIN_WORDS = 20;

type Step = 'enroll' | 'verify' | 'result';

interface VerificationResult {
  similarity: number;
  liveVector: RawVector;
  liveNorm: NormVector;
  baselineNorm: NormVector;
  featureDeltas: FeatureDelta[];
}

function loadSavedBaseline(): RawVector[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 4 || !Array.isArray(parsed.sessions) || parsed.sessions.length < 1) return null;
    const valid = parsed.sessions.filter((s: any) =>
      s &&
      typeof s.avgHoldTime === 'number' && Number.isFinite(s.avgHoldTime) &&
      typeof s.avgFlightTime === 'number' && Number.isFinite(s.avgFlightTime) &&
      typeof s.wpm === 'number' && Number.isFinite(s.wpm)
    );
    return valid.length >= 1 ? valid : null;
  } catch {
    return null;
  }
}

export default function DemoPage() {
  const [lastRelease, setLastRelease] = useState(0);
  const [selectedSignal, setSelectedSignal] = useState(0);
  const [showTechnical, setShowTechnical] = useState(false);
  const [consent, setConsent] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [step, setStep] = useState<Step>('enroll');
  const [baselineSessions, setBaselineSessions] = useState<RawVector[]>([]);
  const [enrollPassageIdx, setEnrollPassageIdx] = useState(0);
  const [typedText, setTypedText] = useState('');
  const [isPasted, setIsPasted] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);

  // Tracking keystrokes
  const downMap = useRef(new Map<string, number>());
  const keystrokesRef = useRef<KeystrokeEvent[]>([]);
  const flightsRef = useRef<FlightEvent[]>([]);
  const lastKeyRef = useRef<string | null>(null);
  const lastUpTimeRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Check saved baseline on mount
  useEffect(() => {
    const saved = loadSavedBaseline();
    if (saved && saved.length >= 1) {
      setBaselineSessions(saved);
      setStep('verify');
    }
  }, []);

  const resetKeystrokeTracking = () => {
    setTypedText('');
    setIsPasted(false);
    downMap.current.clear();
    keystrokesRef.current = [];
    flightsRef.current = [];
    lastKeyRef.current = null;
    lastUpTimeRef.current = null;
    startTimeRef.current = null;
    setLastRelease(0);
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

  // Baseline submission
  const currentWords = wordCount(typedText);
  const canSubmitEnroll = currentWords >= MIN_WORDS && keystrokesRef.current.length >= 20 && consent;

  const handleEnrollSubmit = () => {
    if (!canSubmitEnroll) return;
    const totalMs = startTimeRef.current ? performance.now() - startTimeRef.current : 3000;
    const vector = extractRawVector({
      keystrokes: keystrokesRef.current,
      flights: flightsRef.current,
      totalDurationMs: totalMs,
      charCount: typedText.length,
    });

    enrollSessionApi(vector).catch(() => {});

    const updated = [...baselineSessions, vector];
    setBaselineSessions(updated);

    if (enrollPassageIdx < 2) {
      setEnrollPassageIdx((i) => i + 1);
      resetKeystrokeTracking();
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 4, sessions: updated }));
      } catch {}
      setStep('verify');
      resetKeystrokeTracking();
    }
  };

  // Verification submission
  const canSubmitVerify = typedText.trim().length >= 25;

  const handleVerifySubmit = async () => {
    if (!canSubmitVerify) return;
    setIsVerifying(true);

    const totalMs = startTimeRef.current ? performance.now() - startTimeRef.current : 3000;
    const liveVector = extractRawVector({
      keystrokes: keystrokesRef.current,
      flights: flightsRef.current,
      totalDurationMs: totalMs,
      charCount: typedText.length,
    });

    const baselineRaw = averageRawVectors(baselineSessions);
    const bNorm = normaliseVector(baselineRaw);
    const lNorm = normaliseVector(liveVector);
    const score = hybridSimilarity(bNorm, lNorm);
    const deltas = computeFeatureDeltas(baselineRaw, liveVector);

    // Call verify API in background
    verifySessionApi(
      liveVector,
      { pasteDetected: isPasted, botSuspected: false },
      undefined,
      baselineSessions
    ).catch(() => {});

    setResult({
      similarity: score,
      liveVector,
      liveNorm: lNorm,
      baselineNorm: bNorm,
      featureDeltas: deltas,
    });
    setIsVerifying(false);
    setStep('result');
  };

  const handleReenroll = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setBaselineSessions([]);
    setEnrollPassageIdx(0);
    setResult(null);
    setStep('enroll');
    resetKeystrokeTracking();
  };

  const handleRetryVerify = () => {
    setResult(null);
    setStep('verify');
    resetKeystrokeTracking();
  };

  const baselineRaw = useMemo(() => {
    return baselineSessions.length > 0 ? averageRawVectors(baselineSessions) : null;
  }, [baselineSessions]);

  const activeIndex = step === 'enroll' ? 0 : step === 'verify' ? 1 : 2;
  const passage = step === 'enroll' ? BASELINE_PASSAGES[enrollPassageIdx] : VERIFY_PASSPHRASE;
  const band = result ? scoreToBand(result.similarity) : 'match';
  const signal = result?.featureDeltas[selectedSignal];
  return <><main id="main-content" className="container lab-main">
    <div className="page-heading"><div><span className="eyebrow">Workspace / typing lab</span><h1>Your rhythm.<br/><span className="serif-word">Under the microscope.</span></h1><p className="text-muted">Build a profile, type again, and look at the differences.</p></div><Link href="/challenge" className="btn btn-secondary">Test with a friend ↗</Link></div>
    <ol className="lab-stepper" aria-label="Verification progress">{['Build your profile','Type a fresh sample','Explore the result'].map((label,i)=><li key={label} className={i===activeIndex?'current':i<activeIndex?'complete':''} aria-current={i===activeIndex?'step':undefined}><span>{`0${i+1}`}</span>{label}</li>)}</ol>
    {step !== 'result' && <div className="lab-grid"><section className="panel typing-panel">
      <div className="section-topline"><span className="eyebrow">{step==='enroll'?`Baseline / passage ${enrollPassageIdx+1} of 3`:'Verification / fresh sample'}</span><span className="chip chip-neutral">{step==='enroll'?'Learning your timing':'Profile ready'}</span></div>
      <h2>{step==='enroll'?'Make yourself comfortable.':'Let’s compare your rhythm.'}</h2><p className="text-muted small">{step==='enroll'?'Type at your usual pace. This is not a speed test.':'Use your normal typing style. A new sample will be compared with your saved baseline.'}</p>
      {step==='enroll'&&<div className="passage-dots" aria-label={`Passage ${enrollPassageIdx+1} of 3`}>{[0,1,2].map(i=><span key={i} className={i<=enrollPassageIdx?'filled':''}/>)}</div>}
      <div className="passage-box"><span className="eyebrow">Text to type</span><p>{passage}</p></div>
      <label className="input-label" htmlFor="typing-input">Your typing area <span className="text-muted">{step==='enroll'?'20 words minimum':'25 characters minimum'}</span></label>
      <textarea id="typing-input" ref={textareaRef} rows={5} value={typedText} onChange={e=>setTypedText(e.target.value)} onKeyDown={onKeyDown} onKeyUp={onKeyUp} onPaste={handlePaste} placeholder="Start here. Keep it natural." spellCheck={false} autoCapitalize="off" autoComplete="off"/>
      {isPasted&&<p className="input-notice" role="status">Please type this one out. Pasting doesn’t give us the timing information we need.</p>}
      {step==='enroll'&&<label className="consent-line"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>I agree to save my numeric typing profile in this browser and send timing metrics to the configured demo backend.</span></label>}
      <div className="typing-actions"><div className="small text-muted" aria-live="polite">{step==='enroll'?`${currentWords} / ${MIN_WORDS} words`: `${typedText.trim().length} characters`}<div className="input-progress"><span style={{width:`${Math.min(100,step==='enroll'?currentWords/MIN_WORDS*100:typedText.trim().length/25*100)}%`}}/></div></div>
      <button className="btn btn-primary" onClick={step==='enroll'?handleEnrollSubmit:handleVerifySubmit} disabled={step==='enroll'?!canSubmitEnroll:!canSubmitVerify||isVerifying}>{step==='enroll'?(enrollPassageIdx<2?'Save & next passage →':'Save profile →'):(isVerifying?'Comparing…':'Compare with my profile →')}</button></div>
    </section><aside className="lab-aside"><RhythmStrip keystrokes={keystrokesRef.current} flights={flightsRef.current} textLength={typedText.length} durationMs={startTimeRef.current?Math.max(0,lastRelease-startTimeRef.current):0}/>
      <div className="aside-note"><span className="eyebrow">A useful detail</span><h3>{step==='enroll'?'Consistency takes a few samples.':'A change is a clue, not a verdict.'}</h3><p className="small text-muted">{step==='enroll'?'We average three passages so a single pause has less influence. Pause if you need to; don’t try to perform.':'A different device, a long pause, or a change in pace can move your score. Compare individual signals before drawing conclusions.'}</p></div>
      {baselineRaw&&<div className="profile-note"><span className="status-dot"/><div><strong>Saved profile</strong><p className="small text-muted">{baselineSessions.length} samples · {Math.round(baselineRaw.wpm)} wpm average</p><button className="btn btn-text" onClick={()=>setShowReset(!showReset)}>Start a new profile</button>{showReset&&<div className="reset-confirm"><p className="small">Replace the baseline saved in this browser? Existing server records are retained.</p><div className="button-row"><button className="btn btn-secondary" onClick={()=>setShowReset(false)}>Keep it</button><button className="btn btn-primary" onClick={()=>{setShowReset(false);setConsent(false);handleReenroll()}}>Start over</button></div></div>}</div></div>}
    </aside></div>}
    {step==='result'&&result&&baselineRaw&&<div className="result-layout">
      <section className={`result-summary panel result-${band}`}><div><span className="eyebrow">Your comparison</span><h2>{band==='match'?'A familiar rhythm.':band==='rushed'?'A change of pace.':'A different pattern.'}</h2><p className="text-muted">{band==='match'?'This sample is close to your saved typing profile.':band==='rushed'?'Some timings shifted. Look at the signals to see where.':'This sample differs from your baseline. That alone does not establish who typed it.'}</p><span className={`chip chip-${band==='match'?'success':band==='rushed'?'warning':'danger'}`}>{band==='match'?'Match':band==='rushed'?'Timing variation':'Anomaly'} · Local comparison</span></div><div className="score-display"><strong>{(result.similarity*100).toFixed(1)}<small>%</small></strong><span>similarity to your profile</span><div className="score-track"><i style={{left:`${Math.min(100,result.similarity*100)}%`}}/></div><div className="score-labels"><span>0</span><span>65</span><span>85</span><span>100</span></div></div></section>
      <section className="panel signal-explorer"><div className="section-topline"><div><span className="eyebrow">The five signals</span><h2>Where did the rhythm change?</h2></div><span className="small text-muted">Select a signal to inspect it</span></div><div className="signal-tabs" role="group" aria-label="Choose signal">{result.featureDeltas.map((fd,i)=><button key={fd.name} aria-pressed={i===selectedSignal} className={i===selectedSignal?'selected':''} onClick={()=>setSelectedSignal(i)}>{fd.name.replace('Variance','variation')}<span>{Math.round(fd.rawLive)} {fd.unit}</span></button>)}</div>
      {signal&&<div className="signal-detail"><div><h3>{signal.name.replace('Variance','variation')}</h3><p className="small text-muted">{['Average time between pressing and releasing a key.','Average gap from a key release to the next key press.','Estimated words per minute, using five characters per word.','Standard deviation of key holds: how much their duration varies.','Standard deviation of inter-key gaps: how much the gaps vary.'][selectedSignal]}</p></div><div className="comparison-bars">{[['Saved baseline',signal.rawBaseline,signal.normBaseline],['This sample',signal.rawLive,signal.normLive]].map(([label,value,norm])=><div className="comparison-row" key={label}><span>{label}</span><div><i style={{width:`${Math.max(1,Number(norm)*100)}%`}}/></div><strong>{Math.round(Number(value))} {signal.unit}</strong></div>)}</div><p className="small text-muted">Raw change: {(signal.rawLive-signal.rawBaseline)>0?'+':''}{(signal.rawLive-signal.rawBaseline).toFixed(1)} {signal.unit}. Bar lengths use the engine’s normalized scale.</p></div>}
      <button className="btn btn-text technical-toggle" aria-expanded={showTechnical} onClick={()=>setShowTechnical(!showTechnical)}>{showTechnical?'Hide':'Show'} full vector comparison {showTechnical?'−':'+'}</button>{showTechnical&&<FlatRadarChart baselineRaw={baselineRaw} liveRaw={result.liveVector} baselineNorm={result.baselineNorm} liveNorm={result.liveNorm} featureDeltas={result.featureDeltas}/>}</section>
      <div className="result-actions"><button className="btn btn-primary" onClick={handleRetryVerify}>Try another sample ↗</button><Link href="/challenge" className="btn btn-secondary">Hand it to a friend →</Link><Link href="/audit" className="text-link">Open server audit log ↗</Link></div><p className="small text-muted">This is a local similarity score, not an identity probability. Server verification is requested separately; audit entries depend on backend availability.</p>
    </div>}
  </main><Footer/></>;
}
