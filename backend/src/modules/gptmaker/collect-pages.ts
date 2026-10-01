/**
 * Lê todas as páginas de uma listagem do GPTMaker. A API não documenta se `page` começa em 0 ou
 * 1 nem o máximo de `pageSize`, então: começa em 0, deduplica por id e para na primeira página
 * vazia ou após duas páginas seguidas sem item novo (cobre as duas bases e APIs que repetem a
 * última página).
 */
export async function collectAllPages<T extends { id: string }>(
  fetchPage: (page: number, pageSize: number) => Promise<T[]>,
  pageSize: number,
  maxPages: number,
): Promise<T[]> {
  const byId = new Map<string, T>();
  let pagesWithoutNew = 0;
  for (let page = 0; page < maxPages; page++) {
    const items = await fetchPage(page, pageSize);
    if (items.length === 0) return [...byId.values()];
    const before = byId.size;
    for (const item of items) byId.set(item.id, item);
    pagesWithoutNew = byId.size === before ? pagesWithoutNew + 1 : 0;
    if (pagesWithoutNew >= 2) return [...byId.values()];
  }
  throw new Error(`listagem do GPTMaker passou de ${maxPages} páginas`);
}
