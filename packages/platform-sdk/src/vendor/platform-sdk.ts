/**
 * @crmthink/platform-sdk — o que um app TypeScript precisa para falar com a plataforma.
 *
 * Autocontido de propósito (só `node:crypto` e `jose`): copie a pasta para o app ou
 * publique como pacote. Nada aqui importa código da plataforma.
 *
 * - `verifyPlatformSignature`: webhooks de eventos e chamada do instalador.
 * - `createSessionVerifier`: JWT RS256 da sessão do iframe, validado pelo JWKS.
 * - `PlatformTokenClient`: token do Bitrix por instalação, com cache e renovação.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

// ─── Assinatura HMAC ───

export const SIGNATURE_HEADER = 'x-platform-signature'
export const DEFAULT_TOLERANCE_SECONDS = 300

export type SignatureResult =
  { ok: true } | { ok: false; reason: 'malformed' | 'expired' | 'mismatch' }

function sameDigest(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest()
  const y = createHash('sha256').update(b).digest()
  return timingSafeEqual(x, y)
}

/**
 * `X-Platform-Signature: t=<unix>,v1=<hex(hmac-sha256(secret, t + "." + body))>`.
 *
 * Use o corpo **cru** (bytes recebidos), nunca o JSON re-serializado. Durante a rotação
 * do segredo o header traz um `v1=` por segredo; passe os seus segredos vigentes.
 */
export function verifyPlatformSignature(input: {
  header: string | undefined | null
  rawBody: string | Buffer
  secrets: string[]
  now?: Date
  toleranceSeconds?: number
}): SignatureResult {
  if (!input.header) return { ok: false, reason: 'malformed' }
  const parts = input.header.split(',').map(part => part.trim())
  const timestamp = Number(parts.find(p => p.startsWith('t='))?.slice(2))
  const signatures = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3))
  if (!Number.isInteger(timestamp) || signatures.length === 0)
    return { ok: false, reason: 'malformed' }
  const now = (input.now ?? new Date()).getTime() / 1000
  if (
    Math.abs(now - timestamp) >
    (input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS)
  ) {
    return { ok: false, reason: 'expired' }
  }
  const body =
    typeof input.rawBody === 'string'
      ? input.rawBody
      : input.rawBody.toString('utf8')
  for (const secret of input.secrets) {
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')
    if (signatures.some(signature => sameDigest(signature, expected)))
      return { ok: true }
  }
  return { ok: false, reason: 'mismatch' }
}

// ─── Envelope de eventos ───

export type PlatformSubscription = {
  id: number
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'trial_expired'
  modality: 'stripe' | 'manual'
  planId: number
  periodStart: string
  periodEnd: string
  version: number
}

export type PlatformEvent = {
  eventId: string
  type: string
  appCode: string
  installationId: number
  memberId: string
  occurredAt: string
  subscription: PlatformSubscription | null
  data: Record<string, unknown>
}

/**
 * Regras de consumo: deduplicar por `eventId` e ignorar evento de assinatura com
 * `version` menor que a última aplicada. Devolve `true` se o evento deve ser aplicado.
 */
export function shouldApply(
  event: PlatformEvent,
  state: {
    seen(eventId: string): boolean
    lastVersion(subscriptionId: number): number | null
  },
): boolean {
  if (state.seen(event.eventId)) return false
  if (!event.subscription) return true
  const last = state.lastVersion(event.subscription.id)
  return last === null || event.subscription.version > last
}

// ─── Sessão do iframe (JWT RS256) ───

export type SessionClaims = JWTPayload & {
  sub: string
  aud: string
  installationId: number
  memberId: string
  domain: string
  isAdmin: boolean
  name: string
  departmentIds: number[]
}

/**
 * Valida o JWT da sessão localmente: assinatura (JWKS), `iss`, `aud` (= seu appCode) e
 * `exp`. O JWKS fica em cache e é recarregado quando chega um `kid` desconhecido
 * (rotação de chave). JWT expirado ⇒ o frontend cria outra sessão com o auth atual do BX24.
 */
export function createSessionVerifier(options: {
  platformUrl: string
  appCode: string
  issuer?: string
  /** Intervalo mínimo entre recargas do JWKS. */
  cooldownMs?: number
  /** Idade máxima do JWKS em cache — menor que a antecedência da rotação (10 min). */
  cacheMaxAgeMs?: number
}) {
  const base = options.platformUrl.replace(/\/+$/, '')
  const jwks = createRemoteJWKSet(new URL(`${base}/.well-known/jwks.json`), {
    cooldownDuration: options.cooldownMs ?? 30_000,
    cacheMaxAge: options.cacheMaxAgeMs ?? 5 * 60_000,
  })
  return async function verifySession(token: string): Promise<SessionClaims> {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: options.issuer ?? base,
      audience: options.appCode,
      algorithms: ['RS256'],
    })
    return payload as SessionClaims
  }
}

// ─── Tokens do Bitrix ───

export type PlatformToken = {
  accessToken: string
  expiresAt: string
  domain: string
  clientEndpoint: string | null
}

export class PlatformError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PlatformError'
  }
}

/**
 * Token por instalação com cache até `expiresAt - 5 min`. Quando o Bitrix responder
 * `expired_token`, chame `refresh(installationId, tokenRecusado)`: a plataforma faz uma
 * renovação só, mesmo com vários processos pedindo ao mesmo tempo. **Nunca** renove
 * direto no `oauth.bitrix.info` — o refresh token é rotacionado e só a plataforma o tem.
 */
export class PlatformTokenClient {
  private readonly cache = new Map<number, PlatformToken>()
  private readonly base: string

  constructor(
    platformUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.base = platformUrl.replace(/\/+$/, '')
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<PlatformToken> {
    const response = await this.fetchImpl(`${this.base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string }
    }
    if (!response.ok) {
      throw new PlatformError(
        response.status,
        body.error?.code ?? `HTTP_${response.status}`,
        body.error?.message ?? 'erro da plataforma',
      )
    }
    return body as unknown as PlatformToken
  }

  async get(installationId: number): Promise<PlatformToken> {
    const cached = this.cache.get(installationId)
    if (
      cached &&
      new Date(cached.expiresAt).getTime() - 5 * 60_000 > this.now()
    )
      return cached
    const token = await this.request(
      `/v1/installations/${installationId}/token`,
    )
    this.cache.set(installationId, token)
    return token
  }

  async refresh(
    installationId: number,
    staleAccessToken: string,
  ): Promise<PlatformToken> {
    const token = await this.request(
      `/v1/installations/${installationId}/token/refresh`,
      {
        method: 'POST',
        body: JSON.stringify({ staleAccessToken }),
      },
    )
    this.cache.set(installationId, token)
    return token
  }

  forget(installationId: number): void {
    this.cache.delete(installationId)
  }
}
