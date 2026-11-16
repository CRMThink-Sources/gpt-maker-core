'use client';

import { useState } from 'react';

export interface LandingTab {
  id: string;
  label: string;
  title: string;
  /** `counter` já vem formatado do servidor (ex.: "Passo 1 de 3"). */
  steps: { text: string; counter: string }[];
}

interface Props {
  tabs: LandingTab[];
  backLabel: string;
  nextLabel: string;
}

/** Primeiros passos da LP (spec landing-page): abas com passos navegáveis; trocar de aba volta ao passo 1. */
export function LandingTabs({ tabs, backLabel, nextLabel }: Props) {
  const [tabId, setTabId] = useState(tabs[0]?.id);
  const [step, setStep] = useState(0);

  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0];
  if (!tab) return null;
  const current = tab.steps[step];
  const last = tab.steps.length - 1;

  return (
    <div>
      <div role="tablist" className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const selected = t.id === tab.id;
          return (
            <button
              key={t.id}
              id={`lp-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="lp-tabpanel"
              onClick={() => {
                setTabId(t.id);
                setStep(0);
              }}
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

      <div
        id="lp-tabpanel"
        role="tabpanel"
        aria-labelledby={`lp-tab-${tab.id}`}
        className="mt-6 rounded-2xl bg-white p-6 ring-1 ring-zinc-200 sm:p-8"
      >
        <p className="text-sm font-semibold text-brand-700">{current?.counter}</p>
        <h3 className="mt-2 text-xl font-semibold text-zinc-900">{tab.title}</h3>
        <p className="mt-3 min-h-16 text-zinc-600">{current?.text}</p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-700 ring-1 ring-zinc-200 enabled:hover:bg-zinc-50 disabled:opacity-40"
          >
            {backLabel}
          </button>
          <button
            type="button"
            disabled={step === last}
            onClick={() => setStep((s) => Math.min(last, s + 1))}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-brand-700 disabled:opacity-40"
          >
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
