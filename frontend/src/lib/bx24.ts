/** Subconjunto do SDK JS do Bitrix24 (`BX24`) usado pelo app embutido. */
export interface Bx24Auth {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  domain: string;
  member_id: string;
}

interface Bx24CallResult {
  data(): unknown;
  error(): unknown;
}

export interface Bx24SelectedUser {
  id: string;
  name: string;
}

interface Bx24 {
  init(callback: () => void): void;
  getAuth(): Bx24Auth | false;
  refreshAuth(callback: (auth: Bx24Auth) => void): void;
  callMethod(
    method: string,
    params: Record<string, unknown>,
    callback: (result: Bx24CallResult) => void,
  ): void;
  selectUsers(callback: (users: Bx24SelectedUser[]) => void): void;
  fitWindow(): void;
}

declare global {
  interface Window {
    BX24?: Bx24;
  }
}

const SDK_URL = 'https://api.bitrix24.com/api/v1/';
const INIT_TIMEOUT_MS = 10_000;

let ready: Promise<Bx24> | undefined;

/** Fora do iframe do Bitrix não há `BX24`; o app mostra aviso em vez de tentar autenticar. */
export function insideBitrix(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

/** Carrega o SDK uma vez e espera o `BX24.init`. */
export function loadBx24(): Promise<Bx24> {
  ready ??= new Promise<Bx24>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('BX24 não inicializou')), INIT_TIMEOUT_MS);
    const init = () =>
      window.BX24!.init(() => {
        clearTimeout(timer);
        resolve(window.BX24!);
      });
    if (window.BX24) return init();
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = init;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Não foi possível carregar o SDK do Bitrix24'));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  return ready;
}

/**
 * Autenticação atual do BX24; `fresh` pede um token novo ao Bitrix (o de `getAuth` pode estar
 * vencido quando a sessão da plataforma é renovada).
 */
export async function bx24Auth(fresh = false): Promise<Bx24Auth> {
  const bx24 = await loadBx24();
  const current = fresh ? false : bx24.getAuth();
  if (current) return current;
  return new Promise((resolve) => bx24.refreshAuth(resolve));
}

export async function bx24Call<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const bx24 = await loadBx24();
  return new Promise((resolve, reject) =>
    bx24.callMethod(method, params, (result) => {
      const error = result.error();
      if (error) reject(new Error(String(error)));
      else resolve(result.data() as T);
    }),
  );
}

export async function bx24SelectUsers(): Promise<Bx24SelectedUser[]> {
  const bx24 = await loadBx24();
  return new Promise((resolve) => bx24.selectUsers(resolve));
}
