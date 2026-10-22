import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { ChevronDown, Loader2, X } from 'lucide-react';
import { providerMeta } from '@/lib/providers';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium transition-all select-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-9 px-3.5 text-sm',
        size === 'lg' && 'h-12 px-5 text-sm',
        variant === 'primary' && 'bg-brand text-zinc-950 shadow-lg shadow-fuchsia-500/15 hover:shadow-fuchsia-500/30 hover:brightness-110',
        variant === 'secondary' && 'raised border border-line bg-panel-2 text-fg hover:border-line-strong hover:bg-panel-3',
        variant === 'subtle' && 'bg-white/[0.04] text-fg hover:bg-white/[0.08]',
        variant === 'ghost' && 'text-muted hover:bg-white/[0.05] hover:text-fg',
        variant === 'danger' && 'border border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/20',
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  active,
  tip = true,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; tip?: boolean }) {
  return (
    <Tooltip label={label} disabled={!tip}>
      <button
        {...rest}
        aria-label={label}
        className={clsx(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-40',
          active ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-white/[0.06] hover:text-fg',
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** Lightweight CSS tooltip. */
export function Tooltip({ label, children, side = 'top', disabled }: { label: ReactNode; children: ReactNode; side?: 'top' | 'right' | 'bottom'; disabled?: boolean }) {
  if (disabled) return <>{children}</>;
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={clsx(
          'pointer-events-none absolute z-[60] rounded-md border border-line-strong bg-panel-3 px-2 py-1 text-[11px] font-medium whitespace-nowrap text-fg opacity-0 shadow-xl transition-opacity delay-300 duration-150 group-hover/tip:opacity-100',
          side === 'top' && 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
          side === 'bottom' && 'top-full left-1/2 mt-1.5 -translate-x-1/2',
          side === 'right' && 'top-1/2 left-full ml-2 -translate-y-1/2',
        )}
      >
        {label}
      </span>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-panel-3 px-1 font-sans text-[10px] font-semibold text-muted">
      {children}
    </kbd>
  );
}

export function Badge({ children, tone = 'default', className }: { children: ReactNode; tone?: 'default' | 'accent' | 'green' | 'red' | 'amber'; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
        tone === 'default' && 'bg-white/[0.05] text-muted',
        tone === 'accent' && 'bg-accent/15 text-accent',
        tone === 'green' && 'bg-emerald-500/15 text-emerald-300',
        tone === 'red' && 'bg-red-500/15 text-red-300',
        tone === 'amber' && 'bg-amber-500/15 text-amber-300',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ProviderBadge({ provider, size = 'sm', className }: { provider: string; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  const m = providerMeta(provider);
  return (
    <span
      title={m.label}
      style={{ backgroundColor: m.color, color: m.ink }}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center font-bold',
        size === 'xs' && 'size-4 rounded text-[9px]',
        size === 'sm' && 'size-5 rounded-md text-[10px]',
        size === 'md' && 'size-7 rounded-lg text-xs',
        size === 'lg' && 'size-9 rounded-xl text-sm',
        className,
      )}
    >
      {m.short}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={clsx('inline-flex rounded-xl border border-line bg-panel/80 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'flex items-center justify-center gap-1.5 rounded-lg font-medium transition',
            size === 'md' ? 'px-3.5 py-1.5 text-sm' : 'px-2.5 py-1 text-xs',
            o.value === value ? 'raised bg-panel-3 text-fg ring-1 ring-line-strong' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, children, onClick, className, disabled }: { active?: boolean; children: ReactNode; onClick?: () => void; className?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40',
        active ? 'border-accent/50 bg-accent/[0.12] text-fg shadow-[0_0_0_1px_rgb(167_139_250/0.15)]' : 'border-line bg-panel-2/60 text-muted hover:border-line-strong hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 select-none">
      <span className="min-w-0">
        <span className="block text-sm text-fg/90">{label}</span>
        {hint && <span className="block text-[11px] text-faint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-brand' : 'bg-line-strong')}
      >
        <span className={clsx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs font-medium text-muted">
        <span className="flex items-center gap-1.5">{label}</span>
        {hint && <span className="truncate text-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Collapsible group in the Studio control panel. */
export function Section({
  icon,
  title,
  summary,
  children,
  defaultOpen = true,
  right,
}: {
  icon: ReactNode;
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="raised rounded-2xl border border-line bg-panel/70">
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span className="flex size-6 items-center justify-center rounded-md bg-white/[0.04] text-accent">{icon}</span>
          <span className="text-[13px] font-semibold">{title}</span>
          {!open && summary && <span className="truncate text-xs text-faint">{summary}</span>}
        </button>
        {right}
        <button onClick={() => setOpen((v) => !v)} className="text-faint hover:text-fg" aria-label={open ? 'Collapse' : 'Expand'}>
          <ChevronDown className={clsx('size-4 transition-transform', !open && '-rotate-90')} />
        </button>
      </div>
      {open && <div className="animate-fade-in space-y-4 px-4 pb-4">{children}</div>}
    </section>
  );
}

export const inputClass =
  'w-full rounded-lg border border-line bg-panel-2/70 px-3 py-2 text-sm text-fg placeholder:text-faint outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/15';

export function Modal({
  open,
  onClose,
  children,
  className,
  title,
  subtitle,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className={clsx('animate-pop-in raised relative flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl', className ?? 'max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-semibold">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
            </div>
            <IconButton label="Close" tip={false} onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <div className="glow-brand flex size-14 items-center justify-center rounded-2xl bg-panel-2 text-accent">{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <div className="max-w-md text-sm leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="glass sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line px-6 py-3.5">
      <div className="mr-2 min-w-0">
        <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}
