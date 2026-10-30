'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import TypingPlayground from './TypingPlayground';

/** Presentation only: the live playground retains its original timing handlers. */
export default function ScrollExperience() {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!section.current || !stage.current) return;
      const rect = section.current.getBoundingClientRect();
      const range = rect.height - window.innerHeight;
      const progress = media.matches ? 1 : Math.max(0, Math.min(1, -rect.top / Math.max(1, range)));
      const eased = progress * progress * (3 - 2 * progress);
      stage.current.style.setProperty('--zoom', String(0.36 + eased * 0.64));
      stage.current.style.setProperty('--scene-scale', String(1 + eased * 0.65));
      stage.current.style.setProperty('--scene-opacity', String(1 - Math.min(1, progress / 0.86)));
      stage.current.style.setProperty('--copy-visibility', progress < 0.26 || media.matches ? 'visible' : 'hidden');
      stage.current.style.setProperty('--copy-opacity', String(Math.max(0, 1 - progress * 4)));
      stage.current.style.setProperty('--laptop-top', `${64 - eased * 49}%`);
      stage.current.style.setProperty('--desk-opacity', String(Math.max(0, 1 - progress * 1.7)));
      setInteractive(progress > 0.88);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    media.addEventListener('change', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      media.removeEventListener('change', schedule);
    };
  }, []);

  return <section ref={section} className="scroll-experience" aria-label="From a wider view to your typing signature">
    <div ref={stage} className="scroll-stage">
      <div className="mountain-scene" aria-hidden="true" />
      <div className="scene-shade" aria-hidden="true" />
      <div className="scene-copy">
        <span className="eyebrow">Identity, beyond the password</span>
        <h1>A closer look.<br/>A different <em>signature.</em></h1>
        <p>The login can look right. The person behind it can be wrong.<br className="desktop-break"/> Discover the rhythm that makes your typing yours.</p>
        <div className="scene-actions"><Link href="/demo" className="btn btn-primary btn-large">Try Finomaly <span aria-hidden="true">↗</span></Link><a href="#how-it-works" className="scene-secondary">How it works <span aria-hidden="true">↓</span></a></div>
      </div>
      <div className={`scene-laptop ${interactive ? 'is-interactive' : ''}`}>
        <div className="laptop-lid">
          <div className="laptop-camera" aria-hidden="true" />
          <div className="laptop-appbar"><span className="laptop-brand">finomaly<span>.</span></span><span>THE TYPING EXPERIMENT</span><span className="laptop-app-status"><i/> Browser sandbox</span></div>
          <fieldset className="laptop-content" disabled={!interactive} aria-label="Live typing playground"><TypingPlayground/></fieldset>
        </div>
        <div className="laptop-base" aria-hidden="true"><span/></div>
        <div className="scene-desk" aria-hidden="true"/>
      </div>
      <div className="scroll-cue" aria-hidden="true"><span/>Scroll to look closer</div>
      <span className="scene-caption">Behavioral identity. An additional signal.</span>
    </div>
  </section>;
}
