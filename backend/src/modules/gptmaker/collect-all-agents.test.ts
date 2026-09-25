import { describe, expect, it } from 'vitest';
import type { GptMakerAgent } from './gptmaker.schemas';
import { collectAllAgents } from './workspace-sync.service';

const agents = (ids: number[]): GptMakerAgent[] => ids.map((id) => ({ id: `a${id}` }));
const ids = (list: GptMakerAgent[]) => list.map((item) => item.id).sort();

/** Simula a API paginada com base 0 ou 1 e o comportamento fora do intervalo. */
function api(total: number, pageSize: number, base: 0 | 1, outOfRange: 'empty' | 'repeat-last') {
  const all = agents(Array.from({ length: total }, (_, i) => i));
  const pages = Math.ceil(total / pageSize);
  return async (page: number) => {
    const index = Math.max(page - base, 0);
    if (index >= pages) {
      return outOfRange === 'empty' ? [] : all.slice((pages - 1) * pageSize);
    }
    return all.slice(index * pageSize, (index + 1) * pageSize);
  };
}

describe('collectAllAgents', () => {
  it.each([
    [0, 'empty'],
    [1, 'empty'],
    [0, 'repeat-last'],
    [1, 'repeat-last'],
  ] as const)('lê tudo com base %i e fora do intervalo %s', async (base, outOfRange) => {
    const result = await collectAllAgents(api(25, 10, base, outOfRange), 10);
    expect(ids(result)).toEqual(ids(agents(Array.from({ length: 25 }, (_, i) => i))));
  });

  it('workspace vazio', async () => {
    await expect(collectAllAgents(async () => [], 10)).resolves.toEqual([]);
  });

  it('para em limite de páginas', async () => {
    let n = 0;
    await expect(collectAllAgents(async () => agents([n++]), 10, 5)).rejects.toThrow(/páginas/);
  });
});
