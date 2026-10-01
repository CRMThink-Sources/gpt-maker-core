import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import { agent, agentBot, tenant } from '../../shared/database/schema/index';
import { BitrixClient, BitrixError } from '../bitrix';

export type ChatbotSyncOutcome =
  'registered' | 'updated' | 'unchanged' | 'unregistered' | 'skipped';

/** Cargo exibido no perfil do bot, abaixo do nome. */
const WORK_POSITION = 'Agente de IA';
/** Foto do bot: baixada da URL do agente e enviada em base64 (limite da v1: 5000x5000). */
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const PHOTO_TIMEOUT_MS = 10_000;

/** Código do bot no portal, único por app: um bot por agente. */
export function botCodeFor(agentId: string): string {
  return `gptmaker_agent_${agentId.replaceAll('-', '')}`;
}

/** O que o perfil do bot espelha do agente; mudou ⇒ `Bot.update`. */
export function profileHashOf(profile: { name: string; avatarUrl: string | null }): string {
  return createHash('sha256')
    .update(JSON.stringify([profile.name, profile.avatarUrl ?? null]))
    .digest('hex');
}

interface RegisterResult {
  bot: { id: number | string };
}

/**
 * Chatbot do Bitrix por agente (spec bitrix-chatbot-channel), via `imbot.v2` com o token da
 * plataforma: bot de Linhas Abertas (`type: openline`, `isSupportOpenline`), eventos por webhook
 * nesta API. Leva o bot ao estado atual do agente, então repetir dá o mesmo resultado: agente não
 * removido ⇒ bot registrado com nome, foto e webhook atuais; removido ⇒ bot desregistrado.
 *
 * `register` é idempotente pelo código mas não atualiza bot existente: nome, foto e `webhookUrl`
 * vão sempre por `Bot.update`.
 */
@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly bitrix: BitrixClient,
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Download da foto do agente; trocado nos testes. */
  fetchFn: typeof fetch = (input, init) => fetch(input, init);

  /** Endereço dos eventos `ONIMBOTV2*` dos bots (recepção na tarefa 9.2). */
  webhookUrl(): string {
    return `${this.env.API_PUBLIC_URL}/bitrix/bots/events`;
  }

  async syncAgent(agentId: string): Promise<ChatbotSyncOutcome> {
    const [row] = await this.db
      .select({
        id: agent.id,
        tenantId: agent.tenantId,
        name: agent.name,
        avatarUrl: agent.avatarUrl,
        status: agent.status,
        installationId: tenant.installationId,
        tenantStatus: tenant.status,
      })
      .from(agent)
      .innerJoin(tenant, eq(tenant.id, agent.tenantId))
      .where(eq(agent.id, agentId));
    // App desinstalado (o Bitrix remove os bots do app) ou sem credencial: nada a fazer agora.
    if (!row || row.tenantStatus === 'UNINSTALLED' || row.tenantStatus === 'AUTH_ERROR') {
      return 'skipped';
    }
    const installationId = Number(row.installationId);
    const [bot] = await this.db.select().from(agentBot).where(eq(agentBot.agentId, row.id));

    if (row.status === 'DELETED') {
      if (!bot) return 'unchanged';
      await this.unregister(installationId, Number(bot.botId));
      await this.db.delete(agentBot).where(eq(agentBot.agentId, row.id));
      this.logger.log({ agentId: row.id, botId: bot.botId }, 'chatbot desregistrado');
      return 'unregistered';
    }

    const hash = profileHashOf(row);
    if (bot?.profileHash === hash) return 'unchanged';

    let botId = bot ? Number(bot.botId) : await this.register(installationId, row);
    if (!bot) await this.saveBot(row, botId, null);
    try {
      await this.update(installationId, botId, row.name);
    } catch (error) {
      if (!isBotNotFound(error)) throw error;
      // Removido no portal (ex.: pelo administrador): registra de novo.
      botId = await this.register(installationId, row);
      await this.saveBot(row, botId, null);
      await this.update(installationId, botId, row.name);
    }
    await this.updatePhoto(installationId, botId, row);
    await this.saveBot(row, botId, hash);
    this.logger.log({ agentId: row.id, botId }, bot ? 'chatbot atualizado' : 'chatbot registrado');
    return bot ? 'updated' : 'registered';
  }

  private async register(
    installationId: number,
    row: { id: string; name: string },
  ): Promise<number> {
    const { result } = await this.bitrix.call<RegisterResult>(
      installationId,
      'imbot.v2.Bot.register',
      {
        fields: {
          code: botCodeFor(row.id),
          type: 'openline',
          isSupportOpenline: true,
          eventMode: 'webhook',
          webhookUrl: this.webhookUrl(),
          properties: { name: row.name, workPosition: WORK_POSITION },
        },
      },
    );
    return Number(result.bot.id);
  }

  private async update(installationId: number, botId: number, name: string): Promise<void> {
    await this.bitrix.call(installationId, 'imbot.v2.Bot.update', {
      botId,
      fields: {
        properties: { name, workPosition: WORK_POSITION },
        isSupportOpenline: true,
        eventMode: 'webhook',
        webhookUrl: this.webhookUrl(),
      },
    });
  }

  /**
   * Foto à parte e sem bloquear: o campo não é documentado na v2 (`personalPhoto`, base64, como
   * o `PERSONAL_PHOTO` da v1). Falha fica no log; nome e webhook já foram aplicados.
   */
  private async updatePhoto(
    installationId: number,
    botId: number,
    row: { id: string; avatarUrl: string | null },
  ): Promise<void> {
    if (!row.avatarUrl) return;
    try {
      const photo = await this.downloadPhoto(row.avatarUrl);
      await this.bitrix.call(installationId, 'imbot.v2.Bot.update', {
        botId,
        fields: { properties: { personalPhoto: photo } },
      });
    } catch (error) {
      this.logger.warn({ agentId: row.id, botId, err: error }, 'foto do chatbot não aplicada');
    }
  }

  private async downloadPhoto(url: string): Promise<string> {
    const response = await this.fetchFn(url, { signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.startsWith('image/')) {
      throw new Error(`foto indisponível: HTTP ${response.status} ${type}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > PHOTO_MAX_BYTES) throw new Error(`foto acima de ${PHOTO_MAX_BYTES} bytes`);
    return bytes.toString('base64');
  }

  /** Já removido no portal não é erro. */
  private async unregister(installationId: number, botId: number): Promise<void> {
    try {
      await this.bitrix.call(installationId, 'imbot.v2.Bot.unregister', { botId });
    } catch (error) {
      if (!isBotNotFound(error)) throw error;
    }
  }

  private async saveBot(
    row: { id: string; tenantId: string },
    botId: number,
    profileHash: string | null,
  ): Promise<void> {
    await this.db
      .insert(agentBot)
      .values({
        agentId: row.id,
        tenantId: row.tenantId,
        botId: String(botId),
        botCode: botCodeFor(row.id),
        profileHash,
      })
      .onConflictDoUpdate({
        target: agentBot.agentId,
        set: { botId: String(botId), profileHash },
      });
  }

  /** Bots do tenant somem com a desinstalação do app: o registro local deixa de valer. */
  async forgetTenantBots(tenantId: string): Promise<void> {
    await this.db.delete(agentBot).where(eq(agentBot.tenantId, tenantId));
  }
}

function isBotNotFound(error: unknown): boolean {
  return error instanceof BitrixError && error.code === 'BOT_NOT_FOUND';
}
