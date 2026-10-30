'use client';
import { useRef,useState } from 'react';
import Link from 'next/link';
import RhythmStrip from './RhythmStrip';
import { IGNORED_KEYS,KeystrokeEvent,FlightEvent } from '@/app/demo/biometrics';
export default function TypingPlayground(){
  const [text,setText]=useState('');
  const [samples,setSamples]=useState<KeystrokeEvent[]>([]);
  const [flights,setFlights]=useState<FlightEvent[]>([]);
  const [lastTime,setLastTime]=useState(0);
  const down=useRef(new Map<string,number>());
  const start=useRef(0);
  const lastUp=useRef<number|null>(null);
  const reset=()=>{setText('');setSamples([]);setFlights([]);down.current.clear();start.current=0;lastUp.current=null;setLastTime(0)};
  return <div className="playground"><div className="playground-heading"><span className="eyebrow">01 / A little experiment</span><button className="btn btn-text" onClick={reset}>Reset ↺</button></div><h2>There’s a rhythm to the way you type.</h2><p className="text-muted">Try a sentence. Watch what happens between the letters.</p>
    <label className="sr-only" htmlFor="playground-input">Try typing a sentence to see your key timings</label><textarea id="playground-input" value={text} rows={3} maxLength={500} placeholder="My passwords can be copied. My rhythm is harder to imitate."
      onChange={e=>setText(e.target.value)} onPaste={e=>e.preventDefault()} spellCheck={false}
      onKeyDown={e=>{if(e.repeat||IGNORED_KEYS.has(e.key))return;const now=performance.now();if(!start.current)start.current=now;down.current.set(e.key,now);if(lastUp.current!==null)setFlights(f=>[...f,{fromKey:'',toKey:'',flightTime:Math.max(1,now-lastUp.current!)}]);}}
      onKeyUp={e=>{if(IGNORED_KEYS.has(e.key))return;const now=performance.now(),pressed=down.current.get(e.key);if(pressed!==undefined){setSamples(s=>[...s,{key:'',downTime:pressed,upTime:now,holdTime:now-pressed}]);down.current.delete(e.key)}lastUp.current=now;setLastTime(now);}}/>
    <RhythmStrip keystrokes={samples} flights={flights} textLength={text.length} durationMs={start.current?lastTime-start.current:0}/>
    <div className="playground-bottom"><span className="micro text-muted">This sandbox runs in your browser. No profile is saved.</span><Link href="/demo">Build your profile ↗</Link></div></div>
}
