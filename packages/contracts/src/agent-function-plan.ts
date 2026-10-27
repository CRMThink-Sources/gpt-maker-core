import type {
  CompiledAgent,
  CompiledIntention,
  CompiledTraining,
  CompiledTransfer,
} from './agent-function-compiler';
import type { AgentSettings } from './agents';

/**
 * Plano de publicação (design D5): o que muda no GPTMaker entre o publicado e o compilado.
 * Treinamentos e intenções casam pela chave estável e mudam quando o hash do conteúdo muda.
 */

/** Estado publicado guardado após cada publicação. */
export interface PublishedFunctionState {
  behavior: string;
  agentType: CompiledAgent['agentType'];
  communicationType: CompiledAgent['communicationType'];
  profile: CompiledAgent['profile'];
  settings: AgentSettings;
  trainings: Array<{ key: string; hash: string }>;
  intentions: Array<{ key: string; hash: string }>;
  /** Regras de transferência entre agentes (design D17); estados antigos não têm. */
  transfers?: Array<{ key: string; hash: string }>;
}

export type DiffLine = { op: 'equal' | 'add' | 'remove'; text: string };

export interface PublicationPlan {
  behavior: { changed: boolean; diff: DiffLine[] };
  /** Campos do agente (tipo, tom, dados da empresa) que mudam. */
  agent: Array<{ field: string; from: unknown; to: unknown }>;
  settings: Array<{ key: string; from: unknown; to: unknown }>;
  trainings: { create: CompiledTraining[]; update: CompiledTraining[]; remove: string[] };
  intentions: { create: CompiledIntention[]; update: CompiledIntention[]; remove: string[] };
  transfers: { create: CompiledTransfer[]; update: CompiledTransfer[]; remove: string[] };
  /** Nada a fazer: a publicação não chama o GPTMaker. */
  empty: boolean;
}

/** JSON com chaves ordenadas: o mesmo conteúdo dá o mesmo texto. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

/** Hash de 53 bits (cyrb53) em hexadecimal: síncrono e igual no navegador e no Node. */
export function contentHash(value: unknown): string {
  const text = typeof value === 'string' ? value : stableStringify(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Diferença por linhas (maior subsequência comum). */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const diff: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      diff.push({ op: 'equal', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      diff.push({ op: 'remove', text: a[i++]! });
    } else {
      diff.push({ op: 'add', text: b[j++]! });
    }
  }
  while (i < a.length) diff.push({ op: 'remove', text: a[i++]! });
  while (j < b.length) diff.push({ op: 'add', text: b[j++]! });
  return diff;
}

export function trainingHash(training: CompiledTraining): string {
  return contentHash(training.text);
}

export function intentionHash(intention: CompiledIntention): string {
  return contentHash(intention.input);
}

export function transferHash(transfer: CompiledTransfer): string {
  return contentHash(transfer);
}

/** Estado a guardar depois de publicar o compilado. */
export function publishedStateOf(compiled: CompiledAgent): PublishedFunctionState {
  return {
    behavior: compiled.behavior,
    agentType: compiled.agentType,
    communicationType: compiled.communicationType,
    profile: compiled.profile,
    settings: compiled.settings,
    trainings: compiled.trainings.map((training) => ({
      key: training.key,
      hash: trainingHash(training),
    })),
    intentions: compiled.intentions.map((intention) => ({
      key: intention.key,
      hash: intentionHash(intention),
    })),
    transfers: compiled.transfers.map((transfer) => ({
      key: transfer.key,
      hash: transferHash(transfer),
    })),
  };
}

function planResources<T extends { key: string }>(
  next: T[],
  published: Array<{ key: string; hash: string }>,
  hash: (item: T) => string,
) {
  const before = new Map(published.map((item) => [item.key, item.hash]));
  const keys = new Set(next.map((item) => item.key));
  return {
    create: next.filter((item) => !before.has(item.key)),
    update: next.filter((item) => before.has(item.key) && before.get(item.key) !== hash(item)),
    remove: published.filter((item) => !keys.has(item.key)).map((item) => item.key),
  };
}

/** Compara o compilado com o publicado (`null`: primeira publicação). */
export function planPublication(
  compiled: CompiledAgent,
  published: PublishedFunctionState | null,
): PublicationPlan {
  const before: PublishedFunctionState = published ?? {
    behavior: '',
    agentType: compiled.agentType,
    communicationType: compiled.communicationType,
    profile: { jobName: '', jobDescription: '', jobSite: '' },
    settings: {},
    trainings: [],
    intentions: [],
  };

  const agent: PublicationPlan['agent'] = [];
  const compare = (field: string, from: unknown, to: unknown) => {
    if (stableStringify(from) !== stableStringify(to)) agent.push({ field, from, to });
  };
  if (published) {
    compare('agentType', before.agentType, compiled.agentType);
    compare('communicationType', before.communicationType, compiled.communicationType);
  }
  compare('jobName', before.profile.jobName, compiled.profile.jobName);
  compare('jobDescription', before.profile.jobDescription, compiled.profile.jobDescription);
  compare('jobSite', before.profile.jobSite, compiled.profile.jobSite);

  const settingKeys = [
    ...new Set([...Object.keys(before.settings), ...Object.keys(compiled.settings)]),
  ].sort();
  const settings = settingKeys.flatMap((key) => {
    const from = (before.settings as Record<string, unknown>)[key];
    const to = (compiled.settings as Record<string, unknown>)[key];
    // Setting que sai do compilado mantém o valor no GPTMaker: não é mudança.
    if (to === undefined || stableStringify(from) === stableStringify(to)) return [];
    return [{ key, from, to }];
  });

  const behaviorChanged = before.behavior !== compiled.behavior;
  const trainings = planResources(compiled.trainings, before.trainings, trainingHash);
  const intentions = planResources(compiled.intentions, before.intentions, intentionHash);
  const transfers = planResources(compiled.transfers, before.transfers ?? [], transferHash);
  const empty =
    published !== null &&
    !behaviorChanged &&
    agent.length === 0 &&
    settings.length === 0 &&
    [trainings, intentions, transfers].every(
      (plan) => plan.create.length === 0 && plan.update.length === 0 && plan.remove.length === 0,
    );

  return {
    behavior: {
      changed: behaviorChanged,
      diff: behaviorChanged ? diffLines(before.behavior, compiled.behavior) : [],
    },
    agent,
    settings,
    trainings,
    intentions,
    transfers,
    empty,
  };
}
