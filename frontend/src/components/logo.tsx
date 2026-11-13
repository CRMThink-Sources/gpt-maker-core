'use client';

import { useT } from '@/i18n';

/**
 * Marca do app (GPTThink): o mascote robô (engrenagem na cabeça, visor com olhos sorrindo) sobre
 * gradiente da cor da marca. Mesmo desenho de `public/brand/*.svg` e `app/icon.svg`.
 */
export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="lm-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5A1FE0" />
          <stop offset="1" stopColor="#4410CC" />
        </linearGradient>
        <radialGradient id="sunA" cx="0" cy="0" r="290" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFA23E" />
          <stop offset=".3" stopColor="#FF8A4C" />
          <stop offset=".6" stopColor="#D9468F" stopOpacity=".65" />
          <stop offset="1" stopColor="#7A2BE0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sunB" cx="512" cy="512" r="260" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFA23E" />
          <stop offset=".3" stopColor="#FF8A4C" />
          <stop offset=".6" stopColor="#D9468F" stopOpacity=".65" />
          <stop offset="1" stopColor="#7A2BE0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lm-shell" gradientUnits="userSpaceOnUse" x1="0" y1="84" x2="0" y2="353">
          <stop offset="0" stopColor="#F6F2FF" />
          <stop offset="1" stopColor="#CDC2F5" />
        </linearGradient>
        <linearGradient id="lm-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F4F0FF" />
          <stop offset="1" stopColor="#D2C8F7" />
        </linearGradient>
        <linearGradient id="lm-visor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#261D57" />
          <stop offset="1" stopColor="#150F35" />
        </linearGradient>
        <linearGradient id="lm-glow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5ED8FF" />
          <stop offset="1" stopColor="#7FA8FF" />
        </linearGradient>
        <linearGradient id="lm-ora" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FFB04A" />
          <stop offset="1" stopColor="#FF7A3C" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#lm-brand)" />
      <g stroke="url(#lm-ora)" strokeWidth="15" strokeLinecap="round" opacity=".95">
        <line x1="405" y1="98" x2="429" y2="62" />
        <line x1="430" y1="126" x2="469" y2="106" />
        <line x1="443" y1="162" x2="484" y2="160" />
      </g>
      <rect x="71" y="204" width="56" height="102" rx="38" fill="#1C1640" />
      <rect x="385" y="204" width="56" height="102" rx="38" fill="#1C1640" />
      <rect x="83" y="226" width="13" height="60" rx="6.5" fill="url(#lm-glow)" />
      <rect x="416" y="226" width="13" height="60" rx="6.5" fill="url(#lm-glow)" />
      <rect x="192" y="346" width="126" height="30" rx="14" fill="#B8A9EF" />
      <rect x="156" y="365" width="199" height="81" rx="36" fill="url(#lm-body)" />
      <rect x="222" y="394" width="67" height="14" rx="7" fill="url(#lm-glow)" />
      <path
        fill="url(#lm-shell)"
        d="M120 188 L108 160 Q106 151 114 144 L150 114 Q159 108 168 114 L190 133 L216 127 L220 100 Q222 84 238 84 L278 84 Q294 84 296 100 L298 127 L322 133 L344 114 Q353 108 362 114 L398 144 Q406 151 404 160 L392 188 Q404 200 404 232 L404 300 Q404 353 351 353 L161 353 Q108 353 108 300 L108 232 Q108 200 120 188 Z"
      />
      <rect x="142" y="176" width="228" height="137" rx="62" fill="url(#lm-visor)" />
      <g fill="none" stroke="url(#lm-glow)" strokeWidth="15" strokeLinecap="round">
        <path d="M168 267 Q204 207 240 267" />
        <path d="M274 267 Q310 207 346 267" />
      </g>
    </svg>
  );
}

const TONES = {
  /** Sobre fundo claro (barra do celular, telas de carregamento). */
  light: {
    name: 'text-zinc-900',
    accent: 'text-brand-600',
    sub: 'text-zinc-500',
  },
  /** Sobre fundo escuro (aside). */
  dark: { name: 'text-white', accent: 'text-brand-400', sub: 'text-zinc-400' },
} as const;

/** Logo completo: marca e "GPTThink", como em `public/brand/gptthink-logo.svg`. */
export function Logo({
  subtitle = true,
  tone = 'light',
}: {
  subtitle?: boolean;
  tone?: keyof typeof TONES;
}) {
  const t = useT('shell');
  const colors = TONES[tone];
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="leading-tight">
        <span className={`block text-[15px] font-semibold tracking-tight ${colors.name}`}>
          GPT<span className={colors.accent}>Think</span>
        </span>
        {subtitle && <span className={`block text-[11px] ${colors.sub}`}>{t('tagline')}</span>}
      </span>
    </span>
  );
}
