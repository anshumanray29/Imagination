import { useState } from 'react';
import { CheckCircle2, CircleAlert, Cloud, Database, HardDrive, KeyRound, Plug, Terminal } from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { usd } from '@/lib/format';
import { useProviders, useStatus } from '@/lib/queries';
import { Badge, Button } from '@/components/ui';

export function SettingsPage() {
  const { data: providers } = useProviders();
  const { data: status, refetch } = useStatus();
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

  const totalSpend = status?.spend.reduce((s, x) => s + x.costUsd, 0) ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-8 p-8">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted">
            API keys and storage credentials live in the <code className="rounded bg-panel-2 px-1.5 py-0.5 text-xs text-fg">.env</code> file in the project folder. Edit it,
            then restart IMG (<code className="rounded bg-panel-2 px-1.5 py-0.5 text-xs text-fg">npm run dev</code>). Keys never leave your machine except to call their own
            provider.
          </p>
        </div>

        <Section icon={<Plug className="size-4" />} title="AI providers">
          <div className="divide-y divide-line">
            {providers?.map((p) => (
              <div key={p.id} className="flex flex-wrap items-start gap-4 py-4 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    {p.configured ? <Badge tone="green">connected</Badge> : <Badge tone="amber">no key</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-muted">{p.description}</p>
                  <p className="mt-1 text-xs text-faint">
                    {p.models.length} models · env: {p.envKeys.join(', ')}
                  </p>
                  {results[p.id] && <Result {...results[p.id]!} />}
                </div>
                <Button size="sm" loading={busy === p.id} disabled={!p.configured} onClick={() => run(p.id, () => api.testProvider(p.id))}>
                  Test connection
                </Button>
              </div>
            ))}
          </div>
        </Section>

        <Section icon={status?.storage.driver === 'r2' ? <Cloud className="size-4" /> : <HardDrive className="size-4" />} title="Storage">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1 text-sm">
              {status?.storage.driver === 'r2' ? (
                <p>
                  New files are saved to Cloudflare R2 bucket <b>{status.storage.bucket}</b>. Files are private; IMG shows them through short-lived signed links.
                </p>
              ) : (
                <p>
                  Files are saved on this computer in <code className="text-xs break-all text-muted">{status?.storage.localPath}</code>. Add your R2 credentials to
                  .env to store everything in Cloudflare R2 instead.
                </p>
              )}
              {status && (
                <p className="mt-2 text-xs text-faint">
                  {status.counts.images} images · {status.counts.videos} videos · {status.counts.localAssets} stored locally
                </p>
              )}
              {results.storage && <Result {...results.storage} />}
              {results.migrate && <Result {...results.migrate} />}
              {results.backup && <Result {...results.backup} />}
            </div>
            <div className="flex flex-col gap-2">
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
          </div>
        </Section>

        <Section icon={<KeyRound className="size-4" />} title="Usage">
          {status?.spend.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-faint">
                <tr>
                  <th className="pb-2 font-medium">Provider</th>
                  <th className="pb-2 font-medium">Successful jobs</th>
                  <th className="pb-2 font-medium">Tracked spend</th>
                </tr>
              </thead>
              <tbody>
                {status.spend.map((s) => (
                  <tr key={s.provider} className="border-t border-line">
                    <td className="py-2">{providers?.find((p) => p.id === s.provider)?.name ?? s.provider}</td>
                    <td className="py-2">{s.jobs}</td>
                    <td className="py-2">{usd(s.costUsd)}</td>
                  </tr>
                ))}
                <tr className="border-t border-line font-medium">
                  <td className="py-2">Total</td>
                  <td className="py-2">{status.spend.reduce((s, x) => s + x.jobs, 0)}</td>
                  <td className="py-2">{usd(totalSpend)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted">No completed jobs yet.</p>
          )}
          <p className="mt-3 text-xs text-faint">
            xAI reports the exact cost of every request. For other providers IMG uses list prices from the model catalog when known — check each provider's billing page for
            the real total.
          </p>
        </Section>

        <Section icon={<Terminal className="size-4" />} title="System">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <Row label="ffmpeg" ok={status?.ffmpeg.available} value={status?.ffmpeg.version ?? 'not found — install it for video thumbnails, frames and stitching'} />
            <Row
              label="Prompt tools"
              ok={Boolean(status?.textProviders.length)}
              value={status?.textProviders.length ? `via ${status.textProviders.join(', ')}` : 'add any provider key to enable Enhance / Auto-describe'}
            />
            <Row label="Characters" ok value={String(status?.counts.characters ?? 0)} />
            <Row label="Jobs run" ok value={String(status?.counts.generations ?? 0)} />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel">
      <h2 className="flex items-center gap-2 border-b border-line px-5 py-3 text-sm font-semibold">
        <span className="text-accent">{icon}</span>
        {title}
      </h2>
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
    <div className="rounded-xl border border-line bg-panel-2 px-4 py-3">
      <div className="text-xs text-faint">{label}</div>
      <div className={clsx('mt-0.5 truncate', ok === false && 'text-amber-300')} title={value}>
        {value}
      </div>
    </div>
  );
}
