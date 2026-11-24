import { addDays, USAGE_LIMITS, type AdminUsage, type AdminUsageDay } from '@aplikaacja/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { useAdminUsage } from './data.ts';
import { formatCount } from './format.ts';

const card = 'rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100 sm:p-6';

/** Every day of the period, days without any use as zeros. */
function fill(usage: AdminUsage): AdminUsageDay[] {
  const byDay = new Map(usage.days.map((d) => [d.day, d]));
  return Array.from({ length: USAGE_LIMITS.adminDays }, (_, i) => {
    const day = addDays(usage.from, i);
    return byDay.get(day) ?? { day, utterances: 0, tiles: 0, accounts: 0 };
  });
}

/** "24.11" */
const short = (day: string) => `${Number(day.slice(8, 10))}.${day.slice(5, 7)}`;

/** A clean top for the y-axis, at least the largest value. */
function niceMax(max: number): number {
  if (max <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(max));
  return (
    [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * step).find((v) => v >= max) ?? 10 * step
  );
}

/** The element's width in CSS pixels, so the chart's text keeps its size at any width. */
function useWidth<T extends HTMLElement>(initial: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(200, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const H = 160;
const LEFT = 40;
const BOTTOM = 22;
const TOP = 8;

/**
 * One measure per day as columns (statistics v2). Two measures are two charts, never one
 * chart with two scales. Hover shows the day's value; the table below holds every value.
 */
function DailyColumns({
  title,
  days,
  pick,
}: {
  title: string;
  days: AdminUsageDay[];
  pick: (d: AdminUsageDay) => number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth<HTMLDivElement>(480);
  const top = niceMax(Math.max(0, ...days.map(pick)));
  const band = (W - LEFT) / days.length;
  const bar = Math.min(24, band - 2);
  const plot = H - BOTTOM - TOP;
  const y = (v: number) => TOP + plot - (v / top) * plot;
  // Counts: no tick halfway between two whole numbers.
  const ticks = Number.isInteger(top / 2) ? [0, top / 2, top] : [0, top];
  const total = days.reduce((sum, d) => sum + pick(d), 0);
  const shown = hover === null ? null : days[hover];
  return (
    <figure className="min-w-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-slate-900">{title}</span>
        <span className="text-sm text-slate-600">razem {formatCount(total)}</span>
      </figcaption>
      <div className="relative mt-2" ref={box}>
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block"
          role="img"
          aria-label={`${title}: razem ${formatCount(total)} w ostatnich ${days.length} dniach`}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={LEFT}
                x2={W}
                y1={y(t)}
                y2={y(t)}
                className="stroke-slate-200"
                strokeWidth={1}
              />
              <text
                x={LEFT - 6}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-slate-500 text-[11px]"
              >
                {formatCount(t)}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const v = pick(d);
            const x = LEFT + i * band + (band - bar) / 2;
            const h = (v / top) * plot;
            const r = Math.min(4, h, bar / 2);
            const base = TOP + plot;
            return (
              <g key={d.day} onPointerEnter={() => setHover(i)}>
                {/* The whole band is the hit target, larger than the column. */}
                <rect x={LEFT + i * band} y={TOP} width={band} height={plot} fill="transparent" />
                {v > 0 && (
                  <path
                    className={hover === i ? 'fill-brand-700' : 'fill-brand-600'}
                    d={`M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + bar - r} Q${x + bar},${base - h} ${x + bar},${base - h + r} V${base} Z`}
                  />
                )}
              </g>
            );
          })}
          {/* First and last day flush with the plot's edges, so neither is cut off. */}
          {(
            [
              [0, LEFT, 'start'],
              [
                Math.floor(days.length / 2),
                LEFT + Math.floor(days.length / 2) * band + band / 2,
                'middle',
              ],
              [days.length - 1, W, 'end'],
            ] as const
          ).map(([i, x, anchor]) => (
            <text
              key={i}
              x={x}
              y={H - 6}
              textAnchor={anchor}
              className="fill-slate-500 text-[11px]"
            >
              {days[i] ? short(days[i].day) : ''}
            </text>
          ))}
        </svg>
        {shown && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg bg-white px-2 py-1 text-sm whitespace-nowrap shadow ring-1 ring-slate-200"
            style={{ left: `${((LEFT + hover * band + band / 2) / W) * 100}%` }}
          >
            <strong className="text-slate-900">{formatCount(pick(shown))}</strong>{' '}
            <span className="text-slate-600">
              {short(shown.day)} · kont: {formatCount(shown.accounts)}
            </span>
          </div>
        )}
      </div>
    </figure>
  );
}

/** Admin panel, statistics v2: the last 30 days of all accounts together. */
export function UsageChart() {
  const id = useId();
  const usage = useAdminUsage();
  if (!usage.data) return null;
  const days = fill(usage.data);
  return (
    <section className={card} aria-labelledby={`${id}-title`} data-testid="admin-usage">
      <h2 id={`${id}-title`} className="text-lg font-bold text-brand-900">
        Użycie dziennie (ostatnie {USAGE_LIMITS.adminDays} dni)
      </h2>
      <p className="mt-1 text-slate-600">
        Same liczby z urządzeń, bez słów: wypowiedziane zdania (▶, historia, ulubione) i kafelki
        dodane do zdania. Konta z wyłączonymi licznikami się nie liczą.
      </p>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <DailyColumns title="Zdania" days={days} pick={(d) => d.utterances} />
        <DailyColumns title="Kafelki" days={days} pick={(d) => d.tiles} />
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer font-semibold text-brand-800">Tabela</summary>
        <table className="mt-2 w-full max-w-md text-sm" aria-label="Użycie dziennie">
          <thead className="text-left text-slate-600">
            <tr>
              <th className="py-1 font-medium">Dzień</th>
              <th className="py-1 text-right font-medium">Zdania</th>
              <th className="py-1 text-right font-medium">Kafelki</th>
              <th className="py-1 text-right font-medium">Konta</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.day} className="border-t border-slate-100">
                <td className="py-1">{short(d.day)}</td>
                <td className="py-1 text-right tabular-nums">{formatCount(d.utterances)}</td>
                <td className="py-1 text-right tabular-nums">{formatCount(d.tiles)}</td>
                <td className="py-1 text-right tabular-nums">{formatCount(d.accounts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
