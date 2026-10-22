import { useEffect, useMemo, useRef, useState } from 'react';
import type { DailyUsage } from '@imagination/shared';
import { money } from '@/lib/format';
import { PROVIDER_ORDER, providerMeta } from '@/lib/providers';

const H = 220;
const M = { top: 10, right: 8, bottom: 26, left: 48 };
const GRID = '#1f1f29'; // one step off the panel surface

function localKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Clean axis maximum with ≤ 4 steps. */
function niceScale(max: number): { top: number; step: number } {
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const step = steps.find((s) => max / s <= 4) ?? Math.ceil(max / 4);
  return { top: Math.max(step, Math.ceil(max / step) * step), step };
}

/** Daily spend, stacked by provider. Color follows the provider, never its rank. */
export function SpendChart({ data, days = 30 }: { data: DailyUsage[]; days?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const { series, rows } = useMemo(() => {
    const today = new Date();
    const keys = Array.from({ length: days }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i));
      return { key: localKey(d), date: d };
    });
    const providers = PROVIDER_ORDER.filter((p) => data.some((d) => d.provider === p && d.costUsd > 0));
    for (const d of data) if (d.costUsd > 0 && !providers.includes(d.provider)) providers.push(d.provider);
    const rows = keys.map(({ key, date }) => {
      const values = providers.map((p) => data.find((d) => d.day === key && d.provider === p)?.costUsd ?? 0);
      const jobs = data.filter((d) => d.day === key).reduce((n, d) => n + d.jobs, 0);
      return { key, date, values, total: values.reduce((a, b) => a + b, 0), jobs };
    });
    return { series: providers, rows };
  }, [data, days]);

  const max = Math.max(0, ...rows.map((r) => r.total));

  // The chart container only exists when there is data and the table view is off.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.floor(entry!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table, max > 0]);

  if (max === 0) {
    return <p className="py-10 text-center text-sm text-muted">No spend in the last {days} days yet. Costs appear here after jobs finish.</p>;
  }

  const { top, step } = niceScale(max);
  const innerW = width - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const slot = innerW / rows.length;
  const barW = Math.min(18, slot * 0.66);
  const y = (v: number) => M.top + innerH - (v / top) * innerH;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.ceil(rows.length / Math.max(2, Math.floor(innerW / 70)));
  const hovered = hover !== null ? rows[hover] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {series.length >= 2 &&
          series.map((p) => (
            <span key={p} className="flex items-center gap-1.5 text-xs text-muted">
              <span className="size-2.5 rounded-sm" style={{ backgroundColor: providerMeta(p).color }} />
              {providerMeta(p).label}
            </span>
          ))}
        <button onClick={() => setTable((v) => !v)} className="ml-auto text-xs font-medium text-muted hover:text-fg">
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {table ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-faint">
            <tr>
              <th className="pb-2 font-medium">Day</th>
              {series.map((p) => (
                <th key={p} className="pb-2 font-medium">
                  {providerMeta(p).label}
                </th>
              ))}
              <th className="pb-2 font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows
              .filter((r) => r.total > 0)
              .reverse()
              .map((r) => (
                <tr key={r.key} className="border-t border-line">
                  <td className="py-1.5 text-muted">{r.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                  {r.values.map((v, i) => (
                    <td key={series[i]} className="py-1.5">
                      {v ? money(v) : '—'}
                    </td>
                  ))}
                  <td className="py-1.5 font-medium">{money(r.total)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : (
        <div ref={wrap} className="relative" onMouseLeave={() => setHover(null)}>
          <svg width={width} height={H} role="img" aria-label={`Daily spend for the last ${days} days`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#2e2e3b' : GRID} strokeWidth={1} />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="#5f5f71" className="tabular-nums">
                  {money(t)}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const cx = M.left + slot * i + slot / 2;
              let acc = 0;
              const nonZero = r.values.map((v, s) => ({ v, s })).filter((x) => x.v > 0);
              return (
                <g key={r.key} opacity={hover === null || hover === i ? 1 : 0.4}>
                  {hover === i && <rect x={cx - slot / 2} y={M.top} width={slot} height={innerH} fill="#ffffff" opacity={0.03} rx={4} />}
                  {nonZero.map(({ v, s }, j) => {
                    const y0 = y(acc);
                    acc += v;
                    const isTop = j === nonZero.length - 1;
                    // 2px surface gap above every segment except the top one.
                    const y1 = Math.min(y(acc) + (isTop ? 0 : 2), y0 - 1.5);
                    const h = Math.max(1.5, y0 - y1);
                    const x = cx - barW / 2;
                    const r4 = isTop ? Math.min(4, h, barW / 2) : 0;
                    const d = `M${x},${y0} V${y0 - h + r4} Q${x},${y0 - h} ${x + r4},${y0 - h} H${x + barW - r4} Q${x + barW},${y0 - h} ${x + barW},${y0 - h + r4} V${y0} Z`;
                    return <path key={series[s]} d={d} fill={providerMeta(series[s]!).color} />;
                  })}
                  {i % labelEvery === (rows.length - 1) % labelEvery && (
                    <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill="#5f5f71">
                      {r.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </text>
                  )}
                  <rect x={cx - slot / 2} y={M.top} width={slot} height={innerH + M.bottom} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
          {hovered && hover !== null && (
            <div
              className="pointer-events-none absolute z-10 w-48 rounded-xl border border-line-strong bg-panel-3/95 p-3 text-xs shadow-2xl backdrop-blur"
              style={{
                left: Math.min(Math.max(0, M.left + slot * hover + slot / 2 - 96), width - 192),
                top: Math.max(0, y(hovered.total) - 110),
              }}
            >
              <div className="mb-2 font-semibold">{hovered.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
              {series.map((p, s) =>
                hovered.values[s] ? (
                  <div key={p} className="flex items-center gap-2 py-0.5">
                    <span className="size-2 rounded-sm" style={{ backgroundColor: providerMeta(p).color }} />
                    <span className="flex-1 text-muted">{providerMeta(p).label}</span>
                    <span className="tabular-nums">{money(hovered.values[s]!)}</span>
                  </div>
                ) : null,
              )}
              <div className="mt-1.5 flex justify-between border-t border-line pt-1.5 font-medium">
                <span>{hovered.jobs} jobs</span>
                <span className="tabular-nums">{money(hovered.total)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
