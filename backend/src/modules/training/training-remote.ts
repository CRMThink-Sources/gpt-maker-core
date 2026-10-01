import { training } from '../../shared/database/schema/index';
import {
  collectAllPages,
  type GptMakerClient,
  type GptMakerTraining,
  type GptMakerTrainingType,
} from '../gptmaker';

export type Training = typeof training.$inferSelect;

export const TRAINING_TYPES: readonly GptMakerTrainingType[] = [
  'TEXT',
  'WEBSITE',
  'VIDEO',
  'DOCUMENT',
];

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/** Treinamentos do agente no GPTMaker, de um tipo (a API só lista um tipo por chamada). */
export function listRemoteTrainings(
  client: GptMakerClient,
  gptmakerAgentId: string,
  type: GptMakerTrainingType,
): Promise<GptMakerTraining[]> {
  return collectAllPages(
    (page, pageSize) => client.listTrainings(gptmakerAgentId, type, { page, pageSize }),
    PAGE_SIZE,
    MAX_PAGES,
  );
}

/** Como reconhecer o treinamento local na listagem do GPTMaker. */
export function matcherFor(
  row: Pick<Training, 'type' | 'content' | 'url' | 'documentName'>,
): (candidate: GptMakerTraining) => boolean {
  switch (row.type) {
    case 'TEXT':
      return (candidate) => candidate.text?.trim() === row.content;
    case 'WEBSITE':
      return (candidate) => row.url !== null && sameUrl(candidate.website, row.url);
    case 'VIDEO':
      return (candidate) => row.url !== null && sameUrl(candidate.video, row.url);
    case 'DOCUMENT':
      return (candidate) => candidate.documentName === row.documentName;
  }
}

export function sameUrl(a: string | null | undefined, b: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\/+$/, '').toLowerCase();
  return a !== null && a !== undefined && normalize(a) === normalize(b);
}
