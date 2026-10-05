import { bx24Call } from './bx24';

interface BitrixUser {
  ID: string;
  NAME?: string;
  LAST_NAME?: string;
}

/** Nomes vêm do próprio portal (auth do usuário no BX24); o backend guarda só os ids. */
export async function userNames(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  try {
    const users = await bx24Call<BitrixUser[]>('user.get', { ID: ids });
    return Object.fromEntries(
      users.map((user) => [
        user.ID,
        [user.NAME, user.LAST_NAME].filter(Boolean).join(' ') || `#${user.ID}`,
      ]),
    );
  } catch {
    return {};
  }
}
