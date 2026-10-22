import { priceRange, type ModelPricing } from '@imagination/shared';

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function duration(ms: number | null | undefined): string {
  if (!ms) return '';
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)}s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n === 0) return '$0';
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

/** Compact money for labels and ticks: $0.04, $1.20, $12. */
export function money(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(3)}`;
  if (n < 10) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(0)}`;
}

/** Short list-price label, e.g. "$0.04 / image" or "$0.05–0.20 / sec". */
export function priceLabel(pricing: ModelPricing | undefined, providerId?: string): string | null {
  if (providerId === 'mock') return 'free';
  const r = priceRange(pricing);
  if (!r) return null;
  const unit = r.unit === 'image' ? 'image' : 'sec';
  const lo = money(r.min);
  const approx = pricing?.approximate ? '≈ ' : '';
  return r.max > r.min * 1.001 ? `${approx}${lo}–${money(r.max).slice(1)} / ${unit}` : `${approx}${lo} / ${unit}`;
}

export function elapsed(from: number | null, to: number | null = null): string {
  if (!from) return '';
  const s = Math.max(0, Math.round(((to ?? Date.now()) - from) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
