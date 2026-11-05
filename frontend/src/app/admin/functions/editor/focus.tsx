'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';

/** Lugar de um problema escolhido no painel: o editor abre os cards até ele e rola até lá. */
export interface FocusTarget {
  fieldId?: string;
  intentionKey?: string;
  /** Muda a cada clique: o mesmo problema clicado de novo volta a rolar. */
  nonce: number;
}

export const FocusContext = createContext<FocusTarget | null>(null);

/**
 * Estado aberto de um card do editor. Começa aberto quando pedido (problema, recém-criado) ou quando contém o alvo; abre
 * quando um alvo novo cai dentro dele; rola e pisca quando é o próprio alvo.
 */
export function useFocusCard({
  contains,
  isSelf,
  startOpen,
}: {
  contains: (target: FocusTarget) => boolean;
  isSelf: (target: FocusTarget) => boolean;
  startOpen: boolean;
}) {
  const target = useContext(FocusContext);
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(() => startOpen || (target !== null && contains(target)));
  const [seen, setSeen] = useState(target?.nonce);
  // Ajuste durante a renderização (sem efeito): alvo novo dentro do card abre o card.
  if (target && target.nonce !== seen) {
    setSeen(target.nonce);
    if (contains(target)) setOpen(true);
  }
  const self = target !== null && isSelf(target);
  const nonce = target?.nonce;
  useEffect(() => {
    const el = ref.current;
    if (!self || !el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.animate(
      [{ boxShadow: '0 0 0 3px rgb(239 68 68 / 0.45)' }, { boxShadow: '0 0 0 3px transparent' }],
      { duration: 1800, easing: 'ease-out' },
    );
  }, [self, nonce]);
  return { ref, open, setOpen };
}
