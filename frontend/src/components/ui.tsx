import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertIcon, ArrowLeftIcon, CheckIcon } from './icons';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'ghost-danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700',
  secondary: 'border border-zinc-300 bg-white text-zinc-800 shadow-sm hover:bg-zinc-50',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
  ghost: 'text-zinc-700 hover:bg-zinc-100',
  'ghost-danger': 'text-red-700 hover:bg-red-50',
};

/** Classes de botão, para `<button>` e `<Link>`. */
export function buttonClass(variant: Variant = 'primary', size: 'sm' | 'md' = 'md'): string {
  const sizes = size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm';
  return `inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:pointer-events-none disabled:opacity-50 ${sizes} ${VARIANTS[variant]}`;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
  aside,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /** Conteúdo ao lado do título (ex.: status). */
  aside?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {back && (
        <Link
          href={back.href}
          className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ArrowLeftIcon className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
            {aside}
          </div>
          {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

const TONES = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  zinc: 'bg-zinc-100 text-zinc-600 ring-zinc-500/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
} as const;

const DOTS = {
  green: 'bg-emerald-500',
  zinc: 'bg-zinc-400',
  amber: 'bg-amber-500',
  brand: 'bg-brand-500',
  red: 'bg-red-500',
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      <span className={`size-1.5 rounded-full ${DOTS[tone]}`} />
      {children}
    </span>
  );
}

const ALERTS = {
  error: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
} as const;

export function Alert({
  tone,
  children,
  className = '',
}: {
  tone: keyof typeof ALERTS;
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === 'success' ? CheckIcon : AlertIcon;
  return (
    <div
      role={tone === 'success' ? 'status' : 'alert'}
      className={`flex gap-2.5 rounded-lg border p-3 text-sm ${ALERTS[tone]} ${className}`}
    >
      <Icon className="mt-px size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        {icon}
      </div>
      <h3 className="mt-4 text-sm font-semibold text-zinc-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-zinc-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Chave liga/desliga (`role="switch"`). */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  /** Nome acessível (a chave não tem texto visível). */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? 'bg-brand-600' : 'bg-zinc-200'
      }`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function Spinner({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin text-brand-600 ${className}`} aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity=".2"
        strokeWidth="3"
        fill="none"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-zinc-500" role="status">
      <Spinner />
      {label}
    </div>
  );
}

/** Iniciais sobre cor estável derivada do texto (avatar sem foto). */
export function Avatar({
  name,
  src,
  size = 'md',
}: {
  name: string;
  src?: string | null;
  size?: 'md' | 'lg';
}) {
  const box = size === 'lg' ? 'size-12 text-base' : 'size-9 text-sm';
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- URL externa informada pelo tenant
    return <img src={src} alt="" className={`${box} shrink-0 rounded-full object-cover`} />;
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
  const palette = [
    'bg-brand-100 text-brand-700',
    'bg-sky-100 text-sky-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-800',
    'bg-rose-100 text-rose-700',
  ];
  const hash = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return (
    <span
      className={`${box} flex shrink-0 items-center justify-center rounded-full font-semibold ${palette[hash % palette.length]}`}
    >
      {initials || '?'}
    </span>
  );
}
