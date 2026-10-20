import { create } from 'zustand';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import clsx from 'clsx';

type Tone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

const useToasts = create<{ toasts: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set({ toasts: [...get().toasts, { ...t, id }].slice(-5) });
    setTimeout(() => get().dismiss(id), t.tone === 'error' ? 8000 : 4000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));

export const toast = {
  success: (message: string) => useToasts.getState().push({ tone: 'success', message }),
  error: (err: unknown) => useToasts.getState().push({ tone: 'error', message: err instanceof Error ? err.message : String(err) }),
  info: (message: string) => useToasts.getState().push({ tone: 'info', message }),
};

const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info };

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur',
              t.tone === 'error' ? 'border-red-500/30 bg-red-950/80 text-red-100' : 'border-line bg-panel-2/95 text-fg',
            )}
          >
            <Icon className={clsx('mt-0.5 size-4 shrink-0', t.tone === 'success' && 'text-emerald-400', t.tone === 'info' && 'text-accent')} />
            <p className="flex-1 break-words">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="text-muted hover:text-fg">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
