'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons';

/**
 * Modal centralizado na área visível do iframe: cabeçalho e rodapé fixos, corpo com rolagem
 * própria (textos longos não empurram os botões para fora). Esc e clique fora pedem para fechar;
 * quem usa decide se fecha (ex.: confirmar descarte).
 */
export function Modal({
  title,
  description,
  header,
  footer,
  onRequestClose,
  children,
}: {
  title: string;
  description?: string;
  /** Conteúdo abaixo do título (ex.: indicador de passos). */
  header?: ReactNode;
  footer: ReactNode;
  onRequestClose: () => void;
  children: ReactNode;
}) {
  const close = useRef(onRequestClose);

  useEffect(() => {
    close.current = onRequestClose;
  }, [onRequestClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-zinc-900/40 backdrop-blur-[2px]"
        onClick={() => close.current()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="border-b border-zinc-200 px-6 pt-5 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="modal-title" className="text-lg font-semibold text-zinc-900">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-zinc-500">{description}</p>}
            </div>
            <button
              type="button"
              onClick={() => close.current()}
              className="-mr-2 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              aria-label="Fechar"
            >
              <CloseIcon />
            </button>
          </div>
          {header}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        <div className="border-t border-zinc-200 bg-zinc-50 px-6 py-3">{footer}</div>
      </div>
    </div>
  );
}
