import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Check, Clapperboard, Image as ImageIcon, KeyRound, Layers, Search } from 'lucide-react';
import { priceRange, type MediaKind } from '@imagination/shared';
import { priceLabel } from '@/lib/format';
import { useModelIndex, type ModelEntry } from '@/lib/models';
import { capabilityChips, providerMeta, PROVIDER_ORDER } from '@/lib/providers';
import { Badge, Button, Chip, inputClass, Modal, ProviderBadge, Segmented, Toggle } from './ui';

type Sort = 'recommended' | 'cheapest' | 'priciest';

export function ModelBrowser({
  open,
  onClose,
  kind,
  selected,
  compare,
  onCompare,
  onSelect,
  onSwitchKind,
}: {
  open: boolean;
  onClose: () => void;
  kind: MediaKind;
  selected: string[];
  compare: boolean;
  onCompare: (v: boolean) => void;
  onSelect: (key: string) => void;
  /** Lets a provider with no models for this mode (e.g. video-only fal.ai in Image mode) switch modes. */
  onSwitchKind?: (kind: MediaKind) => void;
}) {
  const index = useModelIndex();
  const [provider, setProvider] = useState<string>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('recommended');

  const all = useMemo(() => [...index.values()].filter((e) => e.model.capabilities.kind === kind), [index, kind]);
  // Every provider, including ones that only offer the other kind, so none silently disappears.
  const providers = useMemo(() => {
    const entries = [...index.values()];
    const ids = [...new Set(entries.map((e) => e.provider.id))];
    return ids.sort((a, b) => PROVIDER_ORDER.indexOf(a) - PROVIDER_ORDER.indexOf(b)).map((id) => entries.find((e) => e.provider.id === id)!.provider);
  }, [index]);
  const otherKind: MediaKind = kind === 'image' ? 'video' : 'image';
  const countOf = (k: MediaKind, providerId?: string) =>
    [...index.values()].filter((e) => e.model.capabilities.kind === k && (!providerId || e.provider.id === providerId)).length;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = all.filter(
      (e) =>
        (provider === 'all' || e.provider.id === provider) &&
        (!needle || `${e.model.name} ${e.model.description} ${e.provider.name} ${e.model.tags?.join(' ')}`.toLowerCase().includes(needle)),
    );
    const price = (e: ModelEntry) => priceRange(e.model.pricing)?.min ?? (e.provider.id === 'mock' ? 0 : Number.POSITIVE_INFINITY);
    const rank = (e: ModelEntry) => (e.provider.configured ? 0 : 2) + (e.model.tags?.includes('recommended') ? 0 : 1);
    return filtered.slice().sort((a, b) => {
      if (sort === 'cheapest') return price(a) - price(b);
      if (sort === 'priciest') return (Number.isFinite(price(b)) ? price(b) : -1) - (Number.isFinite(price(a)) ? price(a) : -1);
      return rank(a) - rank(b);
    });
  }, [all, provider, q, sort]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="h-[86vh] max-w-6xl"
      title={`Choose ${compare ? 'models to compare' : 'a model'}`}
      subtitle={`${all.length} ${kind} models across ${new Set(all.map((e) => e.provider.id)).size} providers · list prices, exact cost shown after each run`}
    >
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col gap-1 border-r border-line p-3">
          <ProviderRow active={provider === 'all'} onClick={() => setProvider('all')} label="All providers" count={all.length} />
          {providers.map((p) => {
            const count = all.filter((e) => e.provider.id === p.id).length;
            const elsewhere = count === 0;
            return (
              <ProviderRow
                key={p.id}
                active={provider === p.id && !elsewhere}
                onClick={() => {
                  if (elsewhere) onSwitchKind?.(otherKind);
                  setProvider(p.id);
                }}
                label={providerMeta(p.id).label}
                badge={<ProviderBadge provider={p.id} />}
                count={count}
                status={p.configured}
                note={elsewhere ? `${otherKind} only` : undefined}
              />
            );
          })}
          <div className="mt-auto rounded-xl border border-line bg-panel-2/60 p-3">
            <Toggle
              label={
                <span className="flex items-center gap-1.5">
                  <Layers className="size-3.5 text-accent" /> Compare
                </span>
              }
              hint="Run one prompt on up to 4 models"
              checked={compare}
              onChange={onCompare}
            />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
            {onSwitchKind && (
              <Segmented
                size="sm"
                value={kind}
                onChange={(k) => onSwitchKind(k)}
                options={[
                  { value: 'image', label: <><ImageIcon className="size-3.5" /> Image models · {countOf('image')}</> },
                  { value: 'video', label: <><Clapperboard className="size-3.5" /> Video models · {countOf('video')}</> },
                ]}
              />
            )}
            <div className="relative min-w-56 flex-1">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <input autoFocus className={clsx(inputClass, 'pl-9')} placeholder="Search models, e.g. cheap, 4K, edit…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <span className="text-xs text-faint">Sort</span>
            {(
              [
                ['recommended', 'Recommended'],
                ['cheapest', 'Cheapest'],
                ['priciest', 'Premium'],
              ] as const
            ).map(([v, label]) => (
              <Chip key={v} active={sort === v} onClick={() => setSort(v)}>
                {label}
              </Chip>
            ))}
          </div>

          <div className="grid flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto p-5 md:grid-cols-2 xl:grid-cols-3">
            {list.map((e) => (
              <ModelCard key={e.key} entry={e} selected={selected.includes(e.key)} compare={compare} onClick={() => onSelect(e.key)} />
            ))}
            {!list.length && (
              <p className="col-span-full py-12 text-center text-sm text-muted">
                {q.trim() ? `No models match “${q}”.` : `${providerMeta(provider).label} has no ${kind} models.`}
              </p>
            )}
            {onSwitchKind && provider !== 'all' && countOf(otherKind, provider) > 0 && (
              <button
                onClick={() => onSwitchKind(otherKind)}
                className="col-span-full flex items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong p-4 text-sm text-muted transition hover:border-accent/50 hover:text-fg"
              >
                {otherKind === 'video' ? <Clapperboard className="size-4 text-accent" /> : <ImageIcon className="size-4 text-accent" />}
                {providerMeta(provider).label} also has {countOf(otherKind, provider)} {otherKind} model{countOf(otherKind, provider) === 1 ? '' : 's'}
                <span className="font-medium text-accent">Show them →</span>
              </button>
            )}
          </div>

          {compare && (
            <div className="flex items-center justify-between border-t border-line px-5 py-3">
              <span className="text-sm text-muted">{selected.length} / 4 selected — each model runs the same prompt</span>
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ProviderRow({
  active,
  onClick,
  label,
  count,
  badge,
  status,
  note,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  badge?: React.ReactNode;
  status?: boolean;
  /** Shown instead of the count, e.g. "video only" — clicking switches mode. */
  note?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={note ? `Switch to ${note.replace(' only', '')} mode to use these models` : undefined}
      className={clsx(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition',
        active ? 'bg-panel-3 text-fg ring-1 ring-line-strong' : 'text-muted hover:bg-white/[0.04] hover:text-fg',
        note && 'opacity-75 hover:opacity-100',
      )}
    >
      {badge ?? <span className="bg-brand size-5 rounded-md" />}
      <span className="flex-1 truncate font-medium">{label}</span>
      {status !== undefined && <span className={clsx('size-1.5 rounded-full', status ? 'bg-emerald-400' : 'bg-amber-400')} title={status ? 'Connected' : 'No API key'} />}
      {note ? (
        <span className="shrink-0 rounded-md border border-line px-1.5 py-px text-[10px] whitespace-nowrap text-muted">{note} →</span>
      ) : (
        <span className="text-xs text-faint tabular-nums">{count}</span>
      )}
    </button>
  );
}

function ModelCard({ entry, selected, compare, onClick }: { entry: ModelEntry; selected: boolean; compare: boolean; onClick: () => void }) {
  const { model, provider } = entry;
  const price = priceLabel(model.pricing, provider.id);
  return (
    <button
      onClick={onClick}
      className={clsx(
        'group raised relative flex flex-col rounded-2xl border p-4 text-left transition',
        selected ? 'border-accent/70 bg-accent/[0.07] shadow-[0_0_0_1px_rgb(167_139_250/0.3)]' : 'border-line bg-panel-2/50 hover:border-line-strong hover:bg-panel-2',
        !provider.configured && 'opacity-60 hover:opacity-90',
      )}
    >
      <div className="flex items-start gap-3">
        <ProviderBadge provider={provider.id} size="md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{model.name}</div>
          <div className="text-[11px] text-faint">{provider.name}</div>
        </div>
        <span
          className={clsx(
            'flex size-5 shrink-0 items-center justify-center border transition',
            compare ? 'rounded-md' : 'rounded-full',
            selected ? 'border-accent bg-accent text-zinc-950' : 'border-line-strong group-hover:border-faint',
          )}
        >
          {selected && <Check className="size-3.5" />}
        </span>
      </div>
      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-muted">{model.description}</p>
      <div className="mt-3 flex flex-wrap gap-1">
        {model.tags?.map((t) => (
          <Badge key={t} tone={t === 'recommended' ? 'accent' : t === 'cheap' ? 'green' : 'default'}>
            {t}
          </Badge>
        ))}
        {capabilityChips(model).map((c) => (
          <span key={c} className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted">
            {c}
          </span>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between pt-4">
        {price ? <span className="text-sm font-semibold tabular-nums">{price}</span> : <span className="text-xs text-faint">Price not published</span>}
        {!provider.configured && (
          <span className="flex items-center gap-1 text-[11px] text-amber-300/90">
            <KeyRound className="size-3" /> add {provider.envKeys[0]}
          </span>
        )}
      </div>
    </button>
  );
}
