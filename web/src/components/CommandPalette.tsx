import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import clsx from 'clsx';
import { Clapperboard, CornerDownLeft, Image as ImageIcon, Images, Layers, ListChecks, Search, Settings, Sparkles, Upload, UserRound, Users } from 'lucide-react';
import { priceLabel } from '@/lib/format';
import { useModelIndex } from '@/lib/models';
import { useCharacters } from '@/lib/queries';
import { useStudio } from '@/lib/studio';
import { pickFiles, useUpload } from '@/lib/upload';
import { Kbd, ProviderBadge } from './ui';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const studio = useStudio();
  const index = useModelIndex();
  const { data: characters } = useCharacters();
  const { upload } = useUpload();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => navigate(path);
    const list: Command[] = [
      { id: 'nav-studio', group: 'Go to', label: 'Studio', icon: <Sparkles className="size-4" />, run: go('/') },
      { id: 'nav-gallery', group: 'Go to', label: 'Gallery', icon: <Images className="size-4" />, run: go('/gallery') },
      { id: 'nav-characters', group: 'Go to', label: 'Characters', icon: <Users className="size-4" />, run: go('/characters') },
      { id: 'nav-queue', group: 'Go to', label: 'Queue & history', icon: <ListChecks className="size-4" />, run: go('/jobs') },
      { id: 'nav-settings', group: 'Go to', label: 'Usage & settings', icon: <Settings className="size-4" />, keywords: 'cost spend billing keys', run: go('/settings') },
      { id: 'new-image', group: 'Create', label: 'New image', icon: <ImageIcon className="size-4" />, run: () => (studio.set({ kind: 'image' }), navigate('/')) },
      { id: 'new-video', group: 'Create', label: 'New video', icon: <Clapperboard className="size-4" />, run: () => (studio.set({ kind: 'video' }), navigate('/')) },
      {
        id: 'compare',
        group: 'Create',
        label: studio.compare ? 'Turn off compare mode' : 'Compare models side by side',
        icon: <Layers className="size-4" />,
        run: () => studio.set({ compare: !studio.compare }),
      },
      {
        id: 'upload',
        group: 'Create',
        label: 'Upload images or videos',
        icon: <Upload className="size-4" />,
        run: async () => void upload(await pickFiles('image/*,video/*')),
      },
    ];
    const models = [...index.values()].sort((a, b) => Number(b.provider.configured) - Number(a.provider.configured));
    for (const e of models) {
      const kind = e.model.capabilities.kind;
      list.push({
        id: `model-${e.key}`,
        group: 'Models',
        label: e.model.name,
        hint: [kind, priceLabel(e.model.pricing, e.provider.id), !e.provider.configured && 'no key'].filter(Boolean).join(' · '),
        icon: <ProviderBadge provider={e.provider.id} size="xs" />,
        keywords: `${e.provider.name} ${kind} ${e.model.tags?.join(' ')}`,
        run: () => {
          studio.set({ kind, compare: false, selected: { ...studio.selected, [kind]: [e.key] } });
          navigate('/');
        },
      });
    }
    for (const c of characters ?? []) {
      list.push({
        id: `char-${c.id}`,
        group: 'Characters',
        label: `${studio.characterIds.includes(c.id) ? 'Remove' : 'Use'} ${c.name}`,
        hint: `${c.assets.length} photos`,
        icon: <UserRound className="size-4" />,
        run: () => (studio.toggleCharacter(c.id), navigate('/')),
      });
    }
    return list;
  }, [index, characters, studio, navigate, upload]);

  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return commands.filter((c) => c.group !== 'Models' || index.get(c.id.slice(6))?.provider.configured);
    return commands.filter((c) => {
      const hay = `${c.group} ${c.label} ${c.hint ?? ''} ${c.keywords ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [commands, q, index]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const runAt = (i: number) => {
    const cmd = filtered[i];
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  let lastGroup = '';
  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-[70] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div className="animate-pop-in raised w-full max-w-xl overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, filtered.length - 1)));
              else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
              else if (e.key === 'Enter') (e.preventDefault(), runAt(active));
              else if (e.key === 'Escape') onClose();
            }}
            placeholder="Search pages, models, characters…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {filtered.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="px-2.5 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider text-faint uppercase">{header}</div>}
                <button
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => runAt(i)}
                  className={clsx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm', i === active ? 'bg-white/[0.06] text-fg' : 'text-fg/85')}
                >
                  <span className="flex size-5 items-center justify-center text-muted">{c.icon}</span>
                  <span className="flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="truncate text-xs text-faint">{c.hint}</span>}
                  {i === active && <CornerDownLeft className="size-3.5 text-faint" />}
                </button>
              </div>
            );
          })}
          {!filtered.length && <p className="px-3 py-8 text-center text-sm text-muted">Nothing matches “{q}”.</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
