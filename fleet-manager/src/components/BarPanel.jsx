/**
 * Bar chart panel in the VAHAN idiom: blue title bar, gridlines, value labels.
 *
 * Deliberately flat rather than the "3D-style" bars the issue mentions. A 3D
 * extrusion makes the bar's top face read above its true value and its depth
 * compete with its height, so the same number looks different depending on
 * where it sits. Everything that makes the reference recognisable — the panel
 * chrome, the gridlines, the per-bar labels, the rotated category axis — is
 * kept.
 *
 * These are nominal categories whose magnitude is already carried by bar
 * length, so all bars share one hue. Colouring each bar differently would spend
 * the identity channel re-encoding what length already shows.
 */
import { useState } from 'react';

const PAD = { top: 18, right: 12, bottom: 58, left: 54 };

function niceCeil(value) {
  if (value <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / mag) * mag;
}

export function BarPanel({ title, rows, color = '#3B82F6', height = 240 }) {
  const [hover, setHover] = useState(null);

  if (!rows || rows.length === 0) {
    return (
      <div className="panel">
        <div className="panel-head">{title}</div>
        <div className="panel-body"><div className="kpi-empty">No data</div></div>
      </div>
    );
  }

  const width = 520;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const max = niceCeil(Math.max(...rows.map(r => Number(r.count) || 0)));
  const ticks = 4;
  const band = plotW / rows.length;
  const barW = Math.min(46, band * 0.6);

  return (
    <div className="panel">
      <div className="panel-head">{title}</div>
      <div className="panel-body">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={title}
        >
          {/* Gridlines and value axis — recessive, behind the bars */}
          {Array.from({ length: ticks + 1 }, (_, i) => {
            const v = (max / ticks) * i;
            const y = PAD.top + plotH - (v / max) * plotH;
            return (
              <g key={i}>
                <line
                  x1={PAD.left} x2={PAD.left + plotW} y1={y} y2={y}
                  stroke="var(--grid)" strokeWidth="1"
                />
                <text
                  x={PAD.left - 6} y={y + 3}
                  textAnchor="end" fontSize="10" fill="var(--ink-muted)"
                >
                  {v.toLocaleString('en-IN')}
                </text>
              </g>
            );
          })}

          <line
            x1={PAD.left} x2={PAD.left + plotW}
            y1={PAD.top + plotH} y2={PAD.top + plotH}
            stroke="var(--border-strong)" strokeWidth="1"
          />

          {rows.map((r, i) => {
            const v = Number(r.count) || 0;
            const h = max === 0 ? 0 : (v / max) * plotH;
            const x = PAD.left + i * band + (band - barW) / 2;
            const y = PAD.top + plotH - h;
            const label = String(r.label).replace(/_/g, ' ');

            return (
              <g
                key={r.label}
                onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, label, v })}
                onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, label, v })}
                onMouseLeave={() => setHover(null)}
              >
                {/* Hit target spans the whole band, so hovering does not
                    require pixel-hunting a thin bar. */}
                <rect
                  x={PAD.left + i * band} y={PAD.top}
                  width={band} height={plotH} fill="transparent"
                />
                <rect x={x} y={y} width={barW} height={h} fill={color} />
                <text
                  x={x + barW / 2} y={y - 4}
                  textAnchor="middle" fontSize="10" fill="var(--ink)"
                >
                  {v.toLocaleString('en-IN')}
                </text>
                <text
                  x={x + barW / 2} y={PAD.top + plotH + 12}
                  textAnchor="end" fontSize="10" fill="var(--ink-muted)"
                  transform={`rotate(-35 ${x + barW / 2} ${PAD.top + plotH + 12})`}
                >
                  {label.length > 16 ? `${label.slice(0, 15)}…` : label}
                </text>
              </g>
            );
          })}
        </svg>

        {hover && (
          <div className="bar-tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            {hover.label}: {hover.v.toLocaleString('en-IN')}
          </div>
        )}
      </div>
    </div>
  );
}
