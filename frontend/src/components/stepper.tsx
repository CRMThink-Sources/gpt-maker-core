import { CheckIcon } from './icons';

/**
 * Indicador de passos dos assistentes (criar agente, intenção). Com `onSelect`, os passos já
 * visitados viram atalhos (útil na edição, em que tudo já está preenchido).
 */
export function Stepper({
  steps,
  current,
  reachable = current,
  onSelect,
}: {
  steps: ReadonlyArray<{ title: string }>;
  current: number;
  /** Último passo que pode ser aberto pelo indicador. */
  reachable?: number;
  onSelect?: (index: number) => void;
}) {
  return (
    <ol className="mt-4 flex items-center gap-2">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const clickable = onSelect && index !== current && index <= reachable;
        const content = (
          <>
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                done
                  ? 'bg-brand-600 text-white'
                  : active
                    ? 'bg-brand-50 text-brand-700 ring-2 ring-brand-600'
                    : 'bg-zinc-100 text-zinc-500'
              }`}
            >
              {done ? <CheckIcon className="size-3.5" strokeWidth={2.5} /> : index + 1}
            </span>
            <span
              className={`hidden text-xs font-medium sm:block ${active ? 'text-zinc-900' : 'text-zinc-500'}`}
            >
              {step.title}
            </span>
          </>
        );
        return (
          <li key={step.title} className="flex flex-1 items-center gap-2">
            {clickable ? (
              <button
                type="button"
                onClick={() => onSelect(index)}
                className="flex items-center gap-2 rounded-md hover:opacity-80"
              >
                {content}
              </button>
            ) : (
              <span className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
                {content}
              </span>
            )}
            {index < steps.length - 1 && (
              <span className={`h-px flex-1 ${done ? 'bg-brand-600' : 'bg-zinc-200'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
