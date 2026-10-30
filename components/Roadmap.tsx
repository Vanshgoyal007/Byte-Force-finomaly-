'use client';

import React from 'react';

const stages = [
  {
    phase: 'NOW',
    text: 'Typing lab, baseline and comparison experiment, two-person challenge, and a synthetic experiment report. Free to explore today.',
  },
  {
    phase: 'NEXT',
    text: 'A developer-facing API pilot, expanded timing features, and testing with real participants beyond synthetic samples.',
  },
  {
    phase: 'LATER',
    text: 'Integration with login flows as an extra signal, with privacy and retention reviewed before any deployment.',
  },
];

const PRIMARY_EMAIL = 'ncharvi02@gmail.com';
const SECONDARY_EMAIL = 'vasu85730@gmail.com';
const EMAIL_SUBJECT = 'Finomaly Pilot Inquiry';
const MAILTO_LINK = `mailto:${PRIMARY_EMAIL}?cc=${SECONDARY_EMAIL}&subject=${encodeURIComponent(EMAIL_SUBJECT)}`;

export default function Roadmap() {
  const triggerEmail = () => {
    const isMobile =
      typeof navigator !== 'undefined' &&
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    // 1. Trigger the standard OS / device email client via mailto
    window.location.href = MAILTO_LINK;

    // 2. Desktop fallback: On Windows/macOS without a configured native mail client,
    // mailto: is silently swallowed by the browser without any window blur.
    // If the window remains focused, open web Gmail in a new tab so the click always succeeds.
    if (!isMobile) {
      const fallbackTimer = setTimeout(() => {
        if (typeof document !== 'undefined' && document.hasFocus()) {
          const gmailComposeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${PRIMARY_EMAIL}&cc=${SECONDARY_EMAIL}&su=${encodeURIComponent(EMAIL_SUBJECT)}`;
          window.open(gmailComposeUrl, '_blank', 'noopener,noreferrer');
        }
      }, 700);

      const cancelFallback = () => {
        clearTimeout(fallbackTimer);
        window.removeEventListener('blur', cancelFallback);
      };
      window.addEventListener('blur', cancelFallback, { once: true });
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    triggerEmail();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      triggerEmail();
    }
  };

  return (
    <section className="roadmap-section" id="roadmap" aria-labelledby="roadmap-title">
      <div className="roadmap-heading">
        <div>
          <span className="eyebrow">03 / Room to grow</span>
          <h2 id="roadmap-title">Start with curiosity.<br/>Build with confidence.</h2>
        </div>
        <p>Finomaly is a research prototype.<br className="desktop-break"/>Here&apos;s where it is today and where it could go.</p>
      </div>
      <div className="roadmap-grid">
        {stages.map((stage) => (
          <article className="roadmap-card" key={stage.phase}>
            <h3>{stage.phase}</h3>
            <p>{stage.text}</p>
          </article>
        ))}
      </div>
      <div className="roadmap-strip">
        <span>Interested in piloting this?</span>
        <a
          href={MAILTO_LINK}
          className="btn btn-secondary"
          role="button"
          tabIndex={0}
          aria-label="Get in touch via email at ncharvi02@gmail.com and vasu85730@gmail.com"
          onClick={handleClick}
          onKeyDown={handleKeyDown}
        >
          Get in touch →
        </a>
      </div>
    </section>
  );
}
