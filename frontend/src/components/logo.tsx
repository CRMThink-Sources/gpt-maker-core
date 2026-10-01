/**
 * Marca do app (ThinkFlow AI): um fluxo que sai de um ponto (o contato no canal) e chega numa
 * faísca (a IA), sobre gradiente da cor da marca. Mesmo desenho de `public/brand/*.svg` e `app/icon.svg`.
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
        d="M12.3 23C16.3 23 14.8 13 18.3 13"
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="7.8" cy="23" r="2.3" fill="white" />
      <path
        d="M23 6Q23.5 9.5 27 10Q23.5 10.5 23 14Q22.5 10.5 19 10Q22.5 9.5 23 6Z"
        fill="white"
      />
    </svg>
  );
}

export function Logo({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight text-zinc-900">
          Think<span className="text-brand-600">Flow</span>
        </span>
        {subtitle && <span className="block text-[11px] text-zinc-500">para Bitrix24</span>}
      </span>
    </span>
  );
}
