'use client';

import React from 'react';
import { RawVector, NormVector, FeatureDelta } from '@/app/demo/biometrics';

interface Props {
  baselineRaw: RawVector;
  liveRaw: RawVector;
  baselineNorm: NormVector;
  liveNorm: NormVector;
  featureDeltas: FeatureDelta[];
}

export default function FlatRadarChart({
  baselineRaw,
  liveRaw,
  baselineNorm,
  liveNorm,
  featureDeltas,
}: Props) {
  // 5 dimensions: Hold time, Flight time, Speed, Hold variance, Flight variance
  const labels = ['Hold time', 'Flight time', 'Speed', 'Hold var', 'Flight var'];
  const size = 320;
  const center = size / 2;
  const radius = 100;
  const count = labels.length;

  const getCoordinates = (index: number, val: number) => {
    // Normalised value typically 0..1, clamp between 0.1 and 1
    const clamped = Math.max(0.05, Math.min(1, val));
    const angle = (Math.PI * 2 / count) * index - Math.PI / 2;
    const r = radius * clamped;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  };

  const baselinePoints = baselineNorm.map((val, i) => {
    const { x, y } = getCoordinates(i, val);
    return `${x},${y}`;
  }).join(' ');

  const livePoints = liveNorm.map((val, i) => {
    const { x, y } = getCoordinates(i, val);
    return `${x},${y}`;
  }).join(' ');

  // Web circles at 25%, 50%, 75%, 100%
  const levels = [0.25, 0.5, 0.75, 1.0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width="100%" height="auto" viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible', maxWidth: 360 }}>
        {/* Background grid */}
        {levels.map((level) => {
          const points = Array.from({ length: count }).map((_, i) => {
            const angle = (Math.PI * 2 / count) * i - Math.PI / 2;
            const r = radius * level;
            return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
          }).join(' ');
          return (
            <polygon
              key={level}
              points={points}
              fill="none"
              stroke="#DDDCD4"
              strokeWidth="1"
            />
          );
        })}

        {/* Spokes */}
        {Array.from({ length: count }).map((_, i) => {
          const angle = (Math.PI * 2 / count) * i - Math.PI / 2;
          const x2 = center + radius * Math.cos(angle);
          const y2 = center + radius * Math.sin(angle);
          return (
            <line
              key={i}
              x1={center}
              y1={center}
              x2={x2}
              y2={y2}
              stroke="#DDDCD4"
              strokeWidth="1"
            />
          );
        })}

        {/* Baseline polygon (neutral solid stroke) */}
        <polygon
          points={baselinePoints}
          fill="rgba(103, 107, 142, 0.08)"
          stroke="#676B8E"
          strokeWidth="1.5"
        />

        {/* Live attempt polygon (accent solid stroke) */}
        <polygon
          points={livePoints}
          fill="rgba(38, 115, 93, 0.12)"
          stroke="#26735D"
          strokeWidth="2"
        />

        {/* Dimension labels */}
        {labels.map((label, i) => {
          const angle = (Math.PI * 2 / count) * i - Math.PI / 2;
          const labelDist = radius + 22;
          const x = center + labelDist * Math.cos(angle);
          const y = center + labelDist * Math.sin(angle);
          return (
            <text
              key={label}
              x={x}
              y={y}
              fontSize="11"
              fill="#202B29"
              textAnchor="middle"
              dominantBaseline="central"
              style={{ fontFamily: 'var(--font-sans)', fontWeight: 500 }}
            >
              {label}
            </text>
          );
        })}
      </svg>

      {/* Flat Legend */}
      <div style={{ display: 'flex', gap: '24px', marginTop: '12px', fontSize: '0.8125rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '12px', height: '2px', background: '#676B8E', display: 'inline-block' }} />
          <span className="text-muted">Enrolled baseline</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '12px', height: '2px', background: '#26735D', display: 'inline-block' }} />
          <span>Live attempt</span>
        </div>
      </div>
    </div>
  );
}
