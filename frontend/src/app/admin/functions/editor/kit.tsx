'use client';

import type { FunctionField } from '@gptmaker/contracts';
import {
  type ComponentType,
  type ReactNode,
  type SVGProps,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BookIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  CircleDotIcon,
  DotsIcon,
  FunnelIcon,
  HashIcon,
  LinkIcon,
  ListIcon,
  PlusIcon,
  TextIcon,
  TrashIcon,
  UserIcon,
} from '@/components/icons';

/**
 * Peças visuais do editor de funções: seções em cartão, controles segmentados, menus e o seletor
 * de tipos. Só aparência; o estado continua com quem usa.
 */

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

/** Cartão de seção com título, descrição e ações à direita. */
export function Section({
  title,
  description,
  icon: Icon,
  actions,
  children,
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconType;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-zinc-200/80 bg-white shadow-xs ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Icon className="size-4" />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
            {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      {children !== undefined && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}

/** Linha de configuração: texto à esquerda, controle à direita. */
export function SettingRow({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-800">{title}</p>
        {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Controle segmentado (escolha única entre poucas opções). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Nome acessível do grupo. */
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg bg-zinc-100 p-0.5 text-xs font-medium"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-md px-2.5 py-1 transition-colors disabled:cursor-not-allowed ${
              active
                ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200'
                : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Ligado/desligado/padrão: `undefined` é "padrão" (não muda). */
export function TriState({
  value,
  onChange,
  disabled,
  label,
  unset = 'Padrão',
  on = 'Ligado',
  off = 'Desligado',
}: {
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
  disabled?: boolean;
  label: string;
  unset?: string;
  on?: string;
  off?: string;
}) {
  return (
    <Segmented
      label={label}
      disabled={disabled}
      value={value === undefined ? 'unset' : value ? 'on' : 'off'}
      options={[
        { value: 'unset', label: unset },
        { value: 'on', label: on },
        { value: 'off', label: off },
      ]}
      onChange={(next) => onChange(next === 'unset' ? undefined : next === 'on')}
    />
  );
}

/** Botão só com ícone (o rótulo vira dica e nome acessível). */
export function IconButton({
  label,
  onClick,
  disabled,
  tone = 'default',
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-7 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-brand-600 disabled:pointer-events-none disabled:opacity-40 ${
        tone === 'danger'
          ? 'text-zinc-400 hover:bg-red-50 hover:text-red-600'
          : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700'
      }`}
    >
      {children}
    </button>
  );
}

/** Subir, descer e remover um item da lista. */
export function ItemActions({
  onUp,
  onDown,
  onRemove,
  disabled,
  removeLabel = 'Remover',
}: {
  onUp?: () => void;
  onDown?: () => void;
  onRemove: () => void;
  disabled?: boolean;
  removeLabel?: string;
}) {
  if (disabled) return null;
  return (
    <div className="flex items-center">
      {onUp && (
        <IconButton label="Subir" onClick={onUp}>
          <ArrowUpIcon className="size-4" />
        </IconButton>
      )}
      {onDown && (
        <IconButton label="Descer" onClick={onDown}>
          <ArrowDownIcon className="size-4" />
        </IconButton>
      )}
      <IconButton label={removeLabel} tone="danger" onClick={onRemove}>
        <TrashIcon className="size-4" />
      </IconButton>
    </div>
  );
}

/** Fecha o painel ao clicar fora ou apertar Esc. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

/** Menu "⋯" com ações secundárias. */
export function Menu({
  items,
  label = 'Mais ações',
}: {
  items: Array<{
    label: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
    title?: string;
  }>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex size-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 shadow-xs hover:bg-zinc-50 hover:text-zinc-800"
      >
        <DotsIcon className="size-5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1.5 w-56 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                item.danger ? 'text-red-600 hover:bg-red-50' : 'text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface PickerItem<K extends string> {
  key: K;
  label: string;
  hint?: string;
  icon: IconType;
  /** Classes de cor do ícone (fundo e texto). */
  tone?: string;
}

/** Botão "+ Adicionar" que abre uma grade de tipos com ícone e explicação. */
export function AddPicker<K extends string>({
  label,
  items,
  onPick,
  disabled,
  columns = 2,
}: {
  label: string;
  items: Array<PickerItem<K>>;
  onPick: (key: K) => void;
  disabled?: boolean;
  columns?: 1 | 2 | 3;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  if (disabled) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-700"
      >
        <PlusIcon className="size-4" />
        {label}
      </button>
      {open && (
        <div
          // Abre no fim da lista, muitas vezes abaixo da dobra: rola até a grade inteira aparecer.
          ref={(el) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
          className={`absolute inset-x-0 z-30 mt-1.5 grid gap-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl ${
            columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : ''
          }`}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(item.key);
              }}
              className="flex items-start gap-3 rounded-lg p-2.5 text-left hover:bg-zinc-50"
            >
              <TypeIcon icon={item.icon} tone={item.tone} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-zinc-900">{item.label}</span>
                {item.hint && (
                  <span className="mt-0.5 block text-xs text-zinc-500">{item.hint}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Quadradinho colorido com o ícone de um tipo. */
export function TypeIcon({
  icon: Icon,
  tone = 'bg-zinc-100 text-zinc-600',
  size = 'md',
}: {
  icon: IconType;
  tone?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg ${tone} ${
        size === 'sm' ? 'size-7' : 'size-8'
      }`}
    >
      <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} />
    </span>
  );
}

/** Ícone e cor de cada tipo de pergunta. */
export const KIND_STYLE: Record<FunctionField['kind'], { icon: IconType; tone: string }> = {
  TEXT: { icon: TextIcon, tone: 'bg-sky-50 text-sky-600' },
  TEXT_LIST: { icon: ListIcon, tone: 'bg-sky-50 text-sky-600' },
  URL: { icon: LinkIcon, tone: 'bg-cyan-50 text-cyan-600' },
  INTEGER: { icon: HashIcon, tone: 'bg-teal-50 text-teal-600' },
  BITRIX_USER: { icon: UserIcon, tone: 'bg-amber-50 text-amber-600' },
  BITRIX_STAGE: { icon: FunnelIcon, tone: 'bg-amber-50 text-amber-600' },
  CHOICE: { icon: CircleDotIcon, tone: 'bg-brand-50 text-brand-600' },
  MULTI_CHOICE: { icon: CheckSquareIcon, tone: 'bg-brand-50 text-brand-600' },
  KNOWLEDGE: { icon: BookIcon, tone: 'bg-emerald-50 text-emerald-600' },
};

/** Grupo recolhível que lembra se foi aberto (não fecha sozinho quando o conteúdo muda). */
export function Disclosure({
  summary,
  initialOpen,
  className = '',
  children,
}: {
  summary: ReactNode;
  initialOpen: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div className={`rounded-lg border border-zinc-200 bg-white ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-zinc-700 select-none hover:bg-zinc-50"
      >
        <ChevronDownIcon
          className={`size-3.5 text-zinc-400 transition-transform ${open ? '' : '-rotate-90'}`}
        />
        <span className="min-w-0 flex-1">{summary}</span>
      </button>
      {open && <div className="border-t border-zinc-100 p-3">{children}</div>}
    </div>
  );
}

/** Lista de problemas de um item. */
export function Issues({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <ul className="space-y-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
      {messages.map((message) => (
        <li key={message} className="flex gap-1.5">
          <span aria-hidden>•</span>
          {message}
        </li>
      ))}
    </ul>
  );
}

/** Rótulo pequeno de um grupo de campos. */
export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5">
      <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{children}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/** Identificador interno em fonte mono. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600">
      {children}
    </code>
  );
}
