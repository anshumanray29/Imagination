import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import clsx from 'clsx';
import { BarChart3, Cloud, HardDrive, Images, ListChecks, Search, Sparkles, Users } from 'lucide-react';
import { money } from '@/lib/format';
import { useGenerations, useLiveEvents, useStatus } from '@/lib/queries';
import { CommandPalette } from '@/components/CommandPalette';
import { Toaster } from '@/components/toast';
import { Tooltip } from '@/components/ui';
import { StudioPage } from '@/pages/Studio';
import { GalleryPage } from '@/pages/Gallery';
import { CharactersPage } from '@/pages/Characters';
import { JobsPage } from '@/pages/Jobs';
import { SettingsPage } from '@/pages/Settings';

export function App() {
  useLiveEvents();
  const { data: gens } = useGenerations(60);
  const { data: status } = useStatus();
  const [palette, setPalette] = useState(false);
  const active = gens?.items.filter((g) => g.status === 'queued' || g.status === 'running').length ?? 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const nav = [
    { to: '/', label: 'Studio', icon: Sparkles, end: true },
    { to: '/gallery', label: 'Gallery', icon: Images },
    { to: '/characters', label: 'Characters', icon: Users },
    { to: '/jobs', label: 'Queue', icon: ListChecks, badge: active || undefined },
    { to: '/settings', label: 'Usage', icon: BarChart3 },
  ];

  return (
    <div className="flex h-full">
      <nav className="glass z-30 flex w-[72px] shrink-0 flex-col items-center gap-1 border-r border-line py-4">
        <div className="bg-brand glow-brand mb-4 flex size-10 items-center justify-center rounded-xl text-[13px] font-black tracking-tight text-zinc-950" title="IMG · Imagination">
          IMG
        </div>
        <Tooltip label={<span>Search & commands · Ctrl K</span>} side="right">
          <button
            onClick={() => setPalette(true)}
            aria-label="Search and commands"
            className="mb-3 flex size-10 items-center justify-center rounded-xl border border-line bg-panel-2/60 text-muted transition hover:border-line-strong hover:text-fg"
          >
            <Search className="size-4" />
          </button>
        </Tooltip>
        {nav.map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx(
                'group relative flex w-[60px] flex-col items-center gap-1 rounded-xl py-2.5 text-[10px] font-medium transition',
                isActive ? 'bg-white/[0.06] text-fg' : 'text-muted hover:bg-white/[0.03] hover:text-fg',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="bg-brand absolute top-1/2 -left-1.5 h-6 w-[3px] -translate-y-1/2 rounded-full" />}
                <Icon className={clsx('size-[19px] transition', isActive && 'text-accent')} />
                {label}
                {badge && (
                  <span className="bg-brand absolute top-1 right-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-zinc-950">
                    {badge}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
        <div className="flex-1" />
        {status && (
          <div className="flex flex-col items-center gap-3">
            <Tooltip label={`Spent today · this month ${money(status.spendMonth)}`} side="right">
              <NavLink to="/settings" className="flex flex-col items-center text-[10px] text-faint hover:text-fg">
                <span className="font-semibold text-fg/80 tabular-nums">{money(status.spendToday)}</span>
                today
              </NavLink>
            </Tooltip>
            <Tooltip label={status.storage.driver === 'r2' ? `Cloudflare R2 · ${status.storage.bucket}` : 'Local disk storage'} side="right">
              <span className="flex flex-col items-center gap-0.5 text-[9px] text-faint">
                {status.storage.driver === 'r2' ? <Cloud className="size-4 text-accent" /> : <HardDrive className="size-4" />}
                {status.storage.driver === 'r2' ? 'R2' : 'Local'}
              </span>
            </Tooltip>
          </div>
        )}
      </nav>
      <div className="min-w-0 flex-1">
        <Routes>
          <Route path="/" element={<StudioPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/characters" element={<CharactersPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <Toaster />
    </div>
  );
}
