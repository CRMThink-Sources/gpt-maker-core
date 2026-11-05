'use client';

import { functionMarkers, isRuntimeMarker, type MarkerOption } from '@gptmaker/contracts';
import { useRef, useState } from 'react';
import { buttonClass } from '@/components/ui';
import { inputClass } from '../../../app/agents/agent-fields';

/**
 * Texto com marcadores (`{{campo}}`): botão que insere no cursor só os marcadores válidos naquele
 * ponto e aviso dos que não existem (design D12).
 */
export function MarkerText({
  value,
  onChange,
  markers,
  rows = 3,
  disabled,
  placeholder,
  allowRuntime = false,
  mono = false,
}: {
  value: string;
  onChange: (text: string) => void;
  markers: MarkerOption[];
  rows?: number;
  disabled?: boolean;
  placeholder?: string;
  /** Textos de intenção aceitam variáveis da execução (`contact.*`, `fields.*`). */
  allowRuntime?: boolean;
  mono?: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const known = new Set(markers.map((item) => item.marker));
  const invalid = functionMarkers(value).filter(
    (marker) => !known.has(marker) && !(allowRuntime && isRuntimeMarker(marker)),
  );

  function insert(marker: string) {
    const el = area.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const token = `{{${marker}}}`;
    onChange(value.slice(0, start) + token + value.slice(end));
    setOpen(false);
    setFilter('');
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const shown = markers.filter(
    (item) =>
      !filter ||
      item.marker.includes(filter.toLowerCase()) ||
      item.label.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div>
      <textarea
        ref={area}
        className={`${inputClass} ${mono ? 'font-mono text-xs leading-relaxed' : ''}`}
        rows={rows}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {!disabled && (
          <div className="relative">
            <button
              type="button"
              className={buttonClass('ghost', 'sm')}
              onClick={() => setOpen(!open)}
            >
              {'{ }'} Inserir campo
            </button>
            {open && (
              <div className="absolute z-20 mt-1 w-80 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg">
                <input
                  className={`${inputClass} mt-0 text-xs`}
                  placeholder="Filtrar…"
                  autoFocus
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <ul className="mt-2 max-h-64 overflow-auto text-xs">
                  {shown.map((item) => (
                    <li key={item.marker}>
                      <button
                        type="button"
                        className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-zinc-100"
                        onClick={() => insert(item.marker)}
                      >
                        <span className="text-zinc-800">{item.label}</span>
                        <span className="font-mono text-zinc-500">{`{{${item.marker}}}`}</span>
                      </button>
                    </li>
                  ))}
                  {shown.length === 0 && (
                    <li className="px-2 py-1.5 text-zinc-500">Nada encontrado.</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
        {invalid.length > 0 && (
          <span className="text-xs text-red-600">
            Não existe: {invalid.map((marker) => `{{${marker}}}`).join(', ')}
          </span>
        )}
      </div>
    </div>
  );
}
