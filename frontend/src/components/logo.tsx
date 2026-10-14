/**
 * Marca do app (GPT Think AI): um balão de conversa (o agente atendendo no canal) com uma faísca
 * (a IA) dentro, sobre gradiente da cor da marca. Mesmo desenho de `public/brand/*.svg` e `app/icon.svg`.
 */
export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="logo-gradient" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#5b21b6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#logo-gradient)" />
      <path
        d="M11.5 7.5h9a4.5 4.5 0 0 1 4.5 4.5v5a4.5 4.5 0 0 1-4.5 4.5H15.2l-4.3 3.7c-.5.4-1.2.1-1.2-.6v-3.4A4.5 4.5 0 0 1 7 17V12a4.5 4.5 0 0 1 4.5-4.5z"
        fill="white"
      />
      <path d="M16 10.2Q16.5 14 20.3 14.5Q16.5 15 16 18.8Q15.5 15 11.7 14.5Q15.5 14 16 10.2Z" fill="#6d28d9" />
    </svg>
  );
}

const TONES = {
  /** Sobre fundo claro (barra do celular, telas de carregamento). */
  light: {
    name: 'text-zinc-900',
    accent: 'text-brand-600',
    ai: 'text-zinc-400',
    sub: 'text-zinc-500',
  },
  /** Sobre fundo escuro (aside). */
  dark: { name: 'text-white', accent: 'text-brand-400', ai: 'text-zinc-500', sub: 'text-zinc-400' },
} as const;

/** Logo completo: marca e "GPT Think AI", como em `public/brand/gptthink-logo.svg`. */
export function Logo({
  subtitle = true,
  tone = 'light',
}: {
  subtitle?: boolean;
  tone?: keyof typeof TONES;
}) {
  const colors = TONES[tone];
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="leading-tight">
        <span className={`block text-[15px] font-semibold tracking-tight ${colors.name}`}>
          GPT <span className={colors.accent}>Think</span>{' '}
          <span className={`font-medium ${colors.ai}`}>AI</span>
        </span>
        {subtitle && (
          <span className={`block text-[11px] ${colors.sub}`}>Agentes de IA para Bitrix24</span>
        )}
      </span>
    </span>
  );
}
