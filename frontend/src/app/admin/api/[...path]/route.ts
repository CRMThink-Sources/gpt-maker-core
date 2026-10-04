import type { NextRequest } from 'next/server';

/** Cabeçalhos do navegador repassados à API (o resto, inclusive hop-by-hop, fica de fora). */
const REQUEST_HEADERS = ['accept', 'content-type', 'cookie', 'x-backoffice'];
/** Da API de volta ao navegador; `set-cookie` vai à parte (pode vir mais de um). */
const RESPONSE_HEADERS = ['content-type', 'x-trace-id'];

/**
 * Repasse do backoffice para a API: o navegador fala só com o frontend (`/admin/api/*` ⇒
 * `<API>/admin/*`), então o cookie da sessão (`gm_admin`, `Path=/admin`, `SameSite=Strict`) é de
 * primeira parte em qualquer ambiente (túnel, porta diferente, domínios distintos), e a API não
 * precisa aceitar credenciais de outra origem. `API_INTERNAL_URL` aponta para a API pela rede
 * interna (Docker); sem ela, vale `PUBLIC_API_BASE_URL`.
 */
async function proxy(request: NextRequest, ctx: RouteContext<'/admin/api/[...path]'>) {
  const { path } = await ctx.params;
  const base =
    process.env.API_INTERNAL_URL ?? process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
  const target = new URL(
    `/admin/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`,
    base,
  );

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
    cache: 'no-store',
  });

  const out = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) out.set(name, value);
  }
  for (const cookie of response.headers.getSetCookie()) out.append('set-cookie', cookie);
  return new Response(response.status === 204 ? null : response.body, {
    status: response.status,
    headers: out,
  });
}

export { proxy as DELETE, proxy as GET, proxy as PATCH, proxy as POST, proxy as PUT };
