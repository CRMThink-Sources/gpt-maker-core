import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { AdminLoginStep } from '@gptmaker/contracts';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DomainError } from '../../shared/http/api-exception.filter';
import { REDIS } from '../../shared/redis/redis.module';
import { AuditService } from './audit.service';
import {
  dummyPasswordHash,
  newTotpSecret,
  otpauthUrl,
  TOTP_STEP_SECONDS,
  verifyPassword,
  verifyTotp,
} from './credentials';
import { type Operator, OperatorService } from './operator.service';

/** Desafio entre senha e código. */
const CHALLENGE_TTL_SECONDS = 5 * 60;
const CHALLENGE_MAX_ATTEMPTS = 5;
/** Senhas erradas seguidas por e-mail antes de bloquear por 15 min. */
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_SECONDS = 15 * 60;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const keys = {
  session: (hash: string) => `backoffice:session:${hash}`,
  sessionsOf: (operatorId: string) => `backoffice:operator-sessions:${operatorId}`,
  challenge: (hash: string) => `backoffice:challenge:${hash}`,
  failures: (email: string) => `backoffice:login-failures:${email.trim().toLowerCase()}`,
  lastStep: (operatorId: string) => `backoffice:totp-last-step:${operatorId}`,
  device: (hash: string) => `backoffice:trusted-device:${hash}`,
  devicesOf: (operatorId: string) => `backoffice:operator-devices:${operatorId}`,
};

interface Challenge {
  operatorId: string;
  attempts: number;
  /** Primeiro acesso: segredo ainda não salvo, confirmado pelo primeiro código. */
  setupSecret?: string;
}

interface Session {
  operatorId: string;
  createdAt: number;
}

export interface SessionUser {
  operator: Operator;
  /** Token em claro, só na criação (vai para o cookie). */
  token?: string;
  /** Token do navegador lembrado, em claro, só quando o operador pediu para lembrar. */
  deviceToken?: string;
}

/** Senha conferida: ou falta o código (`challenge`), ou o navegador lembrado já abriu a sessão. */
export type LoginResult =
  { challenge: AdminLoginStep } | { session: SessionUser & { token: string } };

const invalid = () =>
  new DomainError(
    'INVALID_CREDENTIALS',
    'E-mail, senha ou código inválidos.',
    HttpStatus.UNAUTHORIZED,
  );

/**
 * Login do backoffice em duas etapas (senha, depois TOTP) e sessões no Redis (design D17). O
 * token da sessão é aleatório e só o hash fica no Redis; expira por inatividade e por duração
 * máxima, e é revogado ao trocar a senha, ao desativar o operador e ao zerar o TOTP.
 *
 * "Lembrar este navegador": depois de um código válido, um segundo token (só o hash no Redis,
 * com validade fixa de `BACKOFFICE_TRUSTED_DEVICE_DAYS`) dispensa o código nos próximos logins
 * daquele navegador. A senha continua obrigatória, e o token cai junto com as sessões.
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly operators: OperatorService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async login(
    email: string,
    password: string,
    deviceToken?: string,
    now = Date.now(),
  ): Promise<LoginResult> {
    const failuresKey = keys.failures(email);
    if (Number(await this.redis.get(failuresKey)) >= LOGIN_MAX_FAILURES) {
      throw new DomainError(
        'LOGIN_LOCKED',
        'Muitas tentativas. Aguarde 15 minutos e tente de novo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const operator = await this.operators.findByEmail(email);
    // Sem operador, compara com um hash qualquer: a resposta leva o mesmo tempo.
    const ok = await verifyPassword(
      password,
      operator?.passwordHash ?? (await dummyPasswordHash()),
    );
    if (!operator || !operator.active || !operator.passwordHash || !ok) {
      await this.redis.multi().incr(failuresKey).expire(failuresKey, LOGIN_LOCK_SECONDS).exec();
      this.logger.warn({ email: email.trim().toLowerCase() }, 'login do backoffice recusado');
      throw invalid();
    }
    await this.redis.del(failuresKey);

    if (operator.totpSecret && (await this.trusts(deviceToken, operator.id))) {
      const token = await this.openSession(operator, now, 'Navegador lembrado: sem código');
      return { session: { operator, token } };
    }

    const challenge = randomBytes(32).toString('base64url');
    if (operator.totpSecret) {
      await this.saveChallenge(challenge, { operatorId: operator.id, attempts: 0 });
      return { challenge: { step: 'totp', challenge } };
    }
    const secret = newTotpSecret();
    await this.saveChallenge(challenge, {
      operatorId: operator.id,
      attempts: 0,
      setupSecret: secret,
    });
    return {
      challenge: {
        step: 'totp-setup',
        challenge,
        secret,
        otpauthUrl: otpauthUrl(this.env.BACKOFFICE_TOTP_ISSUER, operator.email, secret),
      },
    };
  }

  /** Confere o código do desafio e abre a sessão; `rememberDevice` lembra este navegador. */
  async verify(
    challenge: string,
    code: string,
    rememberDevice = false,
    now = Date.now(),
  ): Promise<SessionUser & { token: string }> {
    const key = keys.challenge(sha256(challenge));
    const raw = await this.redis.get(key);
    if (!raw) throw expired();
    const state = JSON.parse(raw) as Challenge;
    const operator = await this.operators.findById(state.operatorId);
    if (!operator?.active) {
      await this.redis.del(key);
      throw invalid();
    }
    const secret = state.setupSecret ?? operator.totpSecret;
    const step = secret ? verifyTotp(secret, code, now) : null;
    const lastStep = Number((await this.redis.get(keys.lastStep(operator.id))) ?? -1);
    if (step === null || step <= lastStep) {
      state.attempts += 1;
      if (state.attempts >= CHALLENGE_MAX_ATTEMPTS) await this.redis.del(key);
      else await this.redis.set(key, JSON.stringify(state), 'KEEPTTL');
      throw invalid();
    }
    await this.redis.del(key);
    // Um código vale uma vez: guarda o passo até ele sair da janela aceita.
    await this.redis.set(keys.lastStep(operator.id), String(step), 'EX', TOTP_STEP_SECONDS * 3);
    if (state.setupSecret) {
      await this.operators.setTotpSecret(operator.id, state.setupSecret);
      await this.audit.record({
        actorId: operator.id,
        action: 'operator.totp_configured',
        entityType: 'backoffice_user',
        entityId: operator.id,
      });
    }

    const deviceToken = rememberDevice ? await this.trustDevice(operator.id) : undefined;
    const token = await this.openSession(
      operator,
      now,
      deviceToken
        ? `Navegador lembrado por ${this.env.BACKOFFICE_TRUSTED_DEVICE_DAYS} dias`
        : undefined,
    );
    return { operator, token, deviceToken };
  }

  /** Sessão do cookie, renovando a inatividade; `null` se expirada, revogada ou inativa. */
  async session(token: string | undefined, now = Date.now()): Promise<SessionUser | null> {
    if (!token) return null;
    const hash = sha256(token);
    const raw = await this.redis.get(keys.session(hash));
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (now - session.createdAt > this.env.BACKOFFICE_SESSION_MAX_HOURS * 3_600_000) {
      await this.redis.del(keys.session(hash));
      return null;
    }
    const operator = await this.operators.findById(session.operatorId);
    if (!operator?.active) {
      await this.redis.del(keys.session(hash));
      return null;
    }
    await this.redis.expire(keys.session(hash), this.env.BACKOFFICE_SESSION_IDLE_MINUTES * 60);
    return { operator };
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const hash = sha256(token);
    const raw = await this.redis.get(keys.session(hash));
    await this.redis.del(keys.session(hash));
    if (!raw) return;
    const { operatorId } = JSON.parse(raw) as Session;
    await this.redis.srem(keys.sessionsOf(operatorId), hash);
    await this.audit.record({
      actorId: operatorId,
      action: 'operator.logout',
      entityType: 'backoffice_user',
      entityId: operatorId,
    });
  }

  /**
   * Encerra todas as sessões do operador e esquece os navegadores lembrados (troca de senha,
   * desativação, TOTP zerado).
   */
  async revokeAll(operatorId: string): Promise<void> {
    const hashes = await this.redis.smembers(keys.sessionsOf(operatorId));
    if (hashes.length) await this.redis.del(...hashes.map(keys.session));
    const devices = await this.redis.smembers(keys.devicesOf(operatorId));
    if (devices.length) await this.redis.del(...devices.map(keys.device));
    await this.redis.del(keys.sessionsOf(operatorId), keys.devicesOf(operatorId));
  }

  async changePassword(operator: Operator, current: string, next: string): Promise<void> {
    if (!operator.passwordHash || !(await verifyPassword(current, operator.passwordHash))) {
      throw new DomainError(
        'INVALID_PASSWORD',
        'A senha atual não confere.',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.operators.setPassword(operator.id, next);
    await this.revokeAll(operator.id);
    await this.audit.record({
      actorId: operator.id,
      action: 'operator.password_changed',
      entityType: 'backoffice_user',
      entityId: operator.id,
    });
  }

  /** Cria a sessão, marca o último login e audita; devolve o token em claro. */
  private async openSession(operator: Operator, now: number, reason?: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const hash = sha256(token);
    const session: Session = { operatorId: operator.id, createdAt: now };
    await this.redis
      .multi()
      .set(
        keys.session(hash),
        JSON.stringify(session),
        'EX',
        this.env.BACKOFFICE_SESSION_IDLE_MINUTES * 60,
      )
      .sadd(keys.sessionsOf(operator.id), hash)
      .expire(keys.sessionsOf(operator.id), this.env.BACKOFFICE_SESSION_MAX_HOURS * 3600)
      .exec();
    await this.operators.touchLogin(operator.id);
    await this.audit.record({
      actorId: operator.id,
      action: 'operator.login',
      entityType: 'backoffice_user',
      entityId: operator.id,
      reason,
    });
    return token;
  }

  /** Lembra o navegador por `BACKOFFICE_TRUSTED_DEVICE_DAYS`; devolve o token em claro. */
  private async trustDevice(operatorId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const hash = sha256(token);
    const ttl = this.env.BACKOFFICE_TRUSTED_DEVICE_DAYS * 86_400;
    await this.redis
      .multi()
      .set(keys.device(hash), operatorId, 'EX', ttl)
      .sadd(keys.devicesOf(operatorId), hash)
      .expire(keys.devicesOf(operatorId), ttl)
      .exec();
    return token;
  }

  /** O token do navegador lembrado vale e é deste operador (o cookie é por navegador). */
  private async trusts(deviceToken: string | undefined, operatorId: string): Promise<boolean> {
    if (!deviceToken) return false;
    return (await this.redis.get(keys.device(sha256(deviceToken)))) === operatorId;
  }

  private async saveChallenge(challenge: string, state: Challenge): Promise<void> {
    await this.redis.set(
      keys.challenge(sha256(challenge)),
      JSON.stringify(state),
      'EX',
      CHALLENGE_TTL_SECONDS,
    );
  }
}

function expired(): DomainError {
  return new DomainError(
    'CHALLENGE_EXPIRED',
    'O tempo para digitar o código acabou. Entre de novo.',
    HttpStatus.UNAUTHORIZED,
  );
}
