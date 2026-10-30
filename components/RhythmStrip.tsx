'use client';
import { KeystrokeEvent, FlightEvent, extractRawVector } from '@/app/demo/biometrics';
export default function RhythmStrip({keystrokes,flights,textLength,durationMs}:{keystrokes:KeystrokeEvent[];flights:FlightEvent[];textLength:number;durationMs:number}) {
  const vector=extractRawVector({keystrokes,flights,charCount:textLength,totalDurationMs:durationMs});
  const recent=keystrokes.slice(-36);
  return <section className="rhythm-strip" aria-label="Live typing metrics"><div className="section-topline"><span className="eyebrow">Your rhythm, in real time</span><span className="small text-muted">{keystrokes.length} key releases captured</span></div>
    <div className="rhythm-bars" aria-hidden="true">{Array.from({length:36},(_,i)=>{const k=recent[i];return <span key={i} className={k?'recorded':''} style={{height:k?`${Math.max(5,Math.min(58,k.holdTime/4))}px`:'3px'}}/>})}</div>
    <div className="rhythm-metrics">{[['Hold time',keystrokes.length?Math.round(vector.avgHoldTime):'—','ms'],['Flight time',flights.length?Math.round(vector.avgFlightTime):'—','ms'],['Typing speed',keystrokes.length?Math.round(vector.wpm):'—','wpm']].map(([label,value,unit])=><div key={label}><span>{label}</span><strong>{value}<small>{unit}</small></strong></div>)}</div>
    <p className="micro text-muted">Each bar is a released key. Taller bars mean longer holds. Only numeric timing metrics are sent for comparison.</p>
  </section>;
}
