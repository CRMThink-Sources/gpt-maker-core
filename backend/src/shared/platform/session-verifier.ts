import { createSessionVerifier, type SessionClaims } from '@crmthink-sources/platform-sdk';

export type { SessionClaims };

/** Valida o JWT RS256 da sessão do iframe pelo JWKS da plataforma (iss, aud, exp). */
export type SessionVerifier = (token: string) => Promise<SessionClaims>;

export const SESSION_VERIFIER = Symbol('SESSION_VERIFIER');

export function sessionVerifier(options: {
  platformUrl: string;
  appCode: string;
  issuer?: string;
}): SessionVerifier {
  return createSessionVerifier(options);
}
