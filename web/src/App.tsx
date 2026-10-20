import { NavLink, Route, Routes } from 'react-router';
import clsx from 'clsx';
import { Cloud, HardDrive, Images, ListChecks, Settings, Sparkles, Users } from 'lucide-react';
import { useGenerations, useLiveEvents, useStatus } from '@/lib/queries';
import { Toaster } from '@/components/toast';
import { StudioPage } from '@/pages/Studio';
import { GalleryPage } from '@/pages/Gallery';
import { CharactersPage } from '@/pages/Characters';
import { JobsPage } from '@/pages/Jobs';
import { SettingsPage } from '@/pages/Settings';

export function App() {
  useLiveEvents();
  const { data: gens } = useGenerations(60);
  const { data: status } = useStatus();
  const active = gens?.items.filter((g) => g.status === 'queued' || g.status === 'running').length ?? 0;

  const nav = [
    { to: '/', label: 'Studio', icon: Sparkles, end: true },
    { to: '/gallery', label: 'Gallery', icon: Images },
    { to: '/characters', label: 'Characters', icon: Users },
    { to: '/jobs', label: 'Queue', icon: ListChecks, badge: active || undefined },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex h-full">
      <nav className="flex w-[76px] shrink-0 flex-col items-center gap-1 border-r border-line bg-panel/60 py-4">
        <div className="bg-brand mb-5 flex size-10 items-center justify-center rounded-xl text-sm font-black tracking-tight text-zinc-950 shadow-lg shadow-fuchsia-500/20" title="IMG · Imagination">
          IMG
        </div>
        {nav.map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx(
                'relative flex w-[64px] flex-col items-center gap-1 rounded-xl py-2.5 text-[10px] font-medium transition',
                isActive ? 'bg-panel-2 text-fg ring-1 ring-line-strong' : 'text-muted hover:bg-panel-2/60 hover:text-fg',
              )
            }
          >
            <Icon className="size-[18px]" />
            {label}
            {badge && (
              <span className="bg-brand absolute top-1 right-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-zinc-950">
                {badge}
              </span>
            )}
          </NavLink>
        ))}
        <div className="flex-1" />
        {status && (
          <div className="flex flex-col items-center gap-1 text-[9px] text-faint" title={status.storage.driver === 'r2' ? `Cloudflare R2 · ${status.storage.bucket}` : 'Local disk storage'}>
            {status.storage.driver === 'r2' ? <Cloud className="size-4 text-accent" /> : <HardDrive className="size-4" />}
            {status.storage.driver === 'r2' ? 'R2' : 'Local'}
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
      <Toaster />
    </div>
  );
}
