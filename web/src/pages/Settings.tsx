import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { BarChart3, CheckCircle2, CircleAlert, Cloud, Database, HardDrive, Plug, Terminal } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { providerMeta } from '@/lib/providers';
import { useProviders, useStatus } from '@/lib/queries';
import { SpendChart } from '@/components/SpendChart';
import { Badge, Button, PageHeader, ProviderBadge } from '@/components/ui';

export function SettingsPage() {
  const { data: providers } = useProviders();
  const { data: status, refetch } = useStatus();
  const { data: usage } = useQuery({ queryKey: ['usage', 30], queryFn: () => api.usage(30), refetchInterval: 60_000 });
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<{ ok?: boolean; message?: string } | void>) => {
    setBusy(key);
    try {
      const res = await fn();
      if (res && 'message' in res && res.message) setResults((r) => ({ ...r, [key]: { ok: res.ok !== false, message: res.message! } }));
    } catch (err) {
      setResults((r) => ({ ...r, [key]: { ok: false, message: err instanceof Error ? err.message : String(err) } }));
    } finally {
      setBusy(null);
    }
  };

  const total = status?.spend.reduce((s, x) => s + x.costUsd, 0) ?? 0;
  const jobs = status?.spend.reduce((s, x) => s + x.jobs, 0) ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Usage & settings" subtitle="Spend, connections and storage. Keys live in the .env file in the project folder." />
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Spent today" value={money(status?.spendToday ?? 0)} />
          <Stat label="This month" value={money(status?.spendMonth ?? 0)} />
          <Stat label="All time" value={money(total)} />
          <Stat
            label="Successful jobs"
            value={String(jobs)}
            sub={status ? `${plural(status.counts.images, 'image')} · ${plural(status.counts.videos, 'video')} in library` : undefined}
          />
        </div>

        <Card icon={<BarChart3 className="size-4" />} title="Daily spend" subtitle="Last 30 days, by provider. xAI and OpenAI report exact costs; others use list prices.">
          <SpendChart data={usage ?? []} />
        </Card>

        <Card icon={<Plug className="size-4" />} title="AI providers" subtitle="Add or change keys in .env, then restart IMG.">
          <div className="grid gap-3 md:grid-cols-2">
            {providers?.map((p) => {
              const spend = status?.spend.find((s) => s.provider === p.id);
              return (
                <div key={p.id} className="raised flex flex-col rounded-xl border border-line bg-panel-2/50 p-4">
                  <div className="flex items-start gap-3">
                    <ProviderBadge provider={p.id} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{p.name}</span>
                        {p.configured ? <Badge tone="green">connected</Badge> : <Badge tone="amber">no key</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted">{p.description}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-xs text-faint">
                    <span>{p.models.length} models</span>
                    <span>·</span>
                    <span>{spend ? `${spend.jobs} jobs · ${money(spend.costUsd)}` : 'no jobs yet'}</span>
                    <span className="ml-auto font-mono text-[10px]">{p.envKeys[0]}</span>
                  </div>
                  {results[p.id] && <Result {...results[p.id]!} />}
                  <div className="mt-3">
                    <Button size="sm" loading={busy === p.id} disabled={!p.configured} onClick={() => run(p.id, () => api.testProvider(p.id))}>
                      Test connection
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card icon={status?.storage.driver === 'r2' ? <Cloud className="size-4" /> : <HardDrive className="size-4" />} title="Storage">
            <div className="text-sm">
              {status?.storage.driver === 'r2' ? (
                <p>
                  New files go to Cloudflare R2 bucket <b>{status.storage.bucket}</b>. The bucket stays private; IMG shows files through short-lived signed links.
                </p>
              ) : (
                <p>
                  Files are saved on this computer in <code className="text-xs break-all text-muted">{status?.storage.localPath}</code>. Add R2 credentials to .env to store
                  everything in Cloudflare R2.
                </p>
              )}
              {status && (
                <p className="mt-2 text-xs text-faint">
                  {plural(status.counts.images, 'image')} · {plural(status.counts.videos, 'video')} · {status.counts.localAssets} stored locally
                </p>
              )}
              {results.storage && <Result {...results.storage} />}
              {results.migrate && <Result {...results.migrate} />}
              {results.backup && <Result {...results.backup} />}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" loading={busy === 'storage'} onClick={() => run('storage', api.testStorage)}>
                Test storage
              </Button>
              {status?.storage.driver === 'r2' && status.counts.localAssets > 0 && (
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy === 'migrate'}
                  onClick={() =>
                    run('migrate', async () => {
                      const res = await api.migrateToR2();
                      await refetch();
                      return { ok: !res.failed.length, message: `Moved ${res.moved} file(s) to R2${res.failed.length ? `, ${res.failed.length} failed` : ''}.` };
                    })
                  }
                >
                  Move {status.counts.localAssets} local files to R2
                </Button>
              )}
              <Button size="sm" icon={<Database className="size-3.5" />} loading={busy === 'backup'} onClick={() => run('backup', api.backup)}>
                Back up database
              </Button>
            </div>
          </Card>

          <Card icon={<Terminal className="size-4" />} title="System">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <Row label="ffmpeg" ok={status?.ffmpeg.available} value={status?.ffmpeg.version ?? 'not found — needed for video thumbnails, frames, stitching'} />
              <Row
                label="Prompt tools"
                ok={Boolean(status?.textProviders.length)}
                value={status?.textProviders.length ? `via ${status.textProviders.map((p) => providerMeta(p).label).join(' → ')}` : 'add a provider key'}
              />
              <Row label="Characters" ok value={String(status?.counts.characters ?? 0)} />
              <Row label="Jobs run" ok value={String(status?.counts.generations ?? 0)} />
            </div>
            <p className="mt-3 text-xs text-faint">
              Press <span className="font-semibold text-muted">Ctrl K</span> anywhere to jump to a page, switch model or attach a character.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="raised rounded-2xl border border-line bg-panel/70 p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

function Card({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="raised rounded-2xl border border-line bg-panel/70">
      <div className="flex items-start gap-2.5 border-b border-line px-5 py-3.5">
        <span className="mt-0.5 flex size-6 items-center justify-center rounded-md bg-white/[0.04] text-accent">{icon}</span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Result({ ok, message }: { ok: boolean; message: string }) {
  return (
    <p className={clsx('mt-2 flex items-start gap-1.5 text-xs', ok ? 'text-emerald-300' : 'text-red-300')}>
      {ok ? <CheckCircle2 className="mt-px size-3.5 shrink-0" /> : <CircleAlert className="mt-px size-3.5 shrink-0" />}
      <span className="break-words">{message}</span>
    </p>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2/50 px-3.5 py-2.5">
      <div className="text-[11px] text-faint">{label}</div>
      <div className={clsx('mt-0.5 truncate', ok === false && 'text-amber-300')} title={value}>
        {value}
      </div>
    </div>
  );
}
