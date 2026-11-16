'use client';

import { createContext, useContext, type ReactNode } from 'react';

const AdvanceContext = createContext<() => void>(() => undefined);

/** `LandingTabs` fornece o "avançar passo"; as telas simuladas (de servidor) o usam pelo `Hotspot`. */
export const TutorialProvider = AdvanceContext.Provider;

interface HotspotProps {
  /** Nome acessível do alvo (o mesmo `target` do passo). */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * O destaque laranja da tela simulada: único elemento clicável dela, e clicar avança o passo.
 * O conteúdo fica em `<span>` porque o filho de `<button>` só pode ser conteúdo de texto.
 */
export function Hotspot({ label, children, className = '' }: HotspotProps) {
  const advance = useContext(AdvanceContext);
  return (
    <button
      type="button"
      data-tutorial-hotspot=""
      aria-label={label}
      onClick={advance}
      className={`relative cursor-pointer rounded-md text-left outline-2 outline-offset-2 outline-lp-accent ${className}`}
    >
      {children}
      <span
        aria-hidden="true"
        className="absolute -top-1.5 -right-1.5 size-2.5 rounded-full bg-lp-accent ring-2 ring-white"
      />
    </button>
  );
}
