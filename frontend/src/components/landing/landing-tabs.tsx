'use client';

import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { TutorialProvider } from './tutorial/tutorial-context';

export interface LandingStep {
  title: string;
  text: string;
  /** Nome do elemento em destaque na tela (mostrado na dica e usado como nome acessível). */
  target: string;
  /** Já formatado no servidor (ex.: "Passo 1 de 3"); também nomeia a bolinha do passo. */
  counter: string;
  /** Tela simulada (componentes de servidor com um `Hotspot`). */
  screen: ReactNode;
}

export interface LandingTab {
  id: string;
  label: string;
  intro: string;
  steps: LandingStep[];
}

interface Props {
  tabs: LandingTab[];
  labels: { back: string; next: string; finish: string; hint: string };
}

/**
 * Primeiros passos da LP (spec landing-page): abas de tutoriais que simulam o caminho real. Cada
 * passo mostra o texto à esquerda e a tela simulada à direita; clicar no destaque laranja (ou em
 * Próximo) avança. Trocar de aba volta ao passo 1; Concluir recomeça a aba.
 */
export function LandingTabs({ tabs, labels }: Props) {
  const [tabId, setTabId] = useState(tabs[0]?.id);
  const [stepIndex, setStepIndex] = useState(0);

  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0];
  if (!tab) return null;
  const last = tab.steps.length - 1;
  const step = tab.steps[stepIndex];
  if (!step) return null;
  const isLast = stepIndex === last;

  function select(id: string) {
    setTabId(id);
    setStepIndex(0);
  }

  const advance = () => setStepIndex((s) => (s >= last ? 0 : s + 1));

  /** Padrão WAI-ARIA de abas: setas (com volta), Home e End movem a seleção e o foco. */
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = tabs.length;
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % count
        : event.key === 'ArrowLeft'
          ? (index - 1 + count) % count
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null;
    const next = target === null ? undefined : tabs[target];
    if (!next) return;
    event.preventDefault();
    select(next.id);
    document.getElementById(`lp-tab-${next.id}`)?.focus();
  }

  return (
    <div>
      <div role="tablist" className="flex flex-wrap justify-center gap-2">
        {tabs.map((t, index) => {
          const selected = t.id === tab.id;
          return (
            <button
              key={t.id}
              id={`lp-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="lp-tabpanel"
              tabIndex={selected ? 0 : -1}
              onClick={() => select(t.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                selected
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-brand-50'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <p className="mt-5 text-center text-sm text-zinc-600">{tab.intro}</p>

      <div
        id="lp-tabpanel"
        role="tabpanel"
        aria-labelledby={`lp-tab-${tab.id}`}
        className="mt-6 grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] md:items-start"
      >
        <div>
          {/* Altura mínima: os botões abaixo não pulam quando o texto do passo muda de tamanho. */}
          <div aria-live="polite" className="md:min-h-52">
            <p className="text-sm font-semibold text-brand-700">{step.counter}</p>
            <h3 className="mt-2 text-xl font-semibold text-zinc-900">{step.title}</h3>
            <p className="mt-3 text-zinc-600">{step.text}</p>
            <p className="mt-3 text-xs text-zinc-500">
              {labels.hint} <strong className="text-zinc-800">{step.target}</strong>
            </p>
          </div>

          <div aria-hidden="true" className="mt-6 h-1.5 w-28 rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full bg-brand-600 transition-all"
              style={{ width: `${((stepIndex + 1) / tab.steps.length) * 100}%` }}
            />
          </div>
          <div className="mt-4 flex gap-2">
            {tab.steps.map((s, i) => (
              <button
                key={s.counter}
                type="button"
                aria-label={s.counter}
                aria-current={i === stepIndex ? 'step' : undefined}
                onClick={() => setStepIndex(i)}
                className={`h-7 w-7 rounded-full text-xs font-semibold ${
                  i === stepIndex
                    ? 'bg-brand-600 text-white'
                    : 'bg-brand-100 text-brand-700 hover:bg-brand-200'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((s) => Math.max(0, s - 1))}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-700 ring-1 ring-zinc-200 enabled:hover:bg-zinc-50 disabled:opacity-40"
            >
              {labels.back}
            </button>
            <button
              type="button"
              onClick={advance}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {isLast ? labels.finish : labels.next}
            </button>
          </div>
        </div>

        <TutorialProvider value={advance}>
          <div className="min-w-0">{step.screen}</div>
        </TutorialProvider>
      </div>
    </div>
  );
}
