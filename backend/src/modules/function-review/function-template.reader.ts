import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { FunctionTemplateContent } from '@gptmaker/contracts';
import { and, eq } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agentFunctionConfig } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { AgentRepository } from '../agents';
import { FunctionCatalog } from '../agent-functions';

export interface AgentFunctionTemplate {
  content: FunctionTemplateContent;
  functionName: string;
  functionDescription: string;
  agentName: string;
}

/**
 * Template da função de um agente do tenant, compartilhado pela revisão por IA e pela análise de
 * alucinação: a versão a que a configuração do agente está presa (ou a mais recente, com `latest`).
 * Agente de outro tenant responde 404 pelo repositório.
 */
@Injectable()
export class FunctionTemplateReader {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly agentRows: AgentRepository,
    private readonly catalog: FunctionCatalog,
  ) {}

  async forAgent(
    tenantId: string,
    agentId: string,
    options: { latest?: boolean } = {},
  ): Promise<AgentFunctionTemplate> {
    const agent = await this.agentRows.getById(tenantId, agentId);
    const [config] = await this.db
      .select({
        templateId: agentFunctionConfig.templateId,
        versionId: agentFunctionConfig.versionId,
      })
      .from(agentFunctionConfig)
      .where(
        and(eq(agentFunctionConfig.agentId, agentId), eq(agentFunctionConfig.tenantId, tenantId)),
      );
    if (!config) {
      throw new DomainError(
        'FUNCTION_NOT_CONFIGURED',
        'Este agente não tem função configurada',
        HttpStatus.NOT_FOUND,
      );
    }
    const published =
      config.versionId && !options.latest
        ? await this.catalog.versionById(config.versionId)
        : await this.catalog.latestOfTemplate(config.templateId);
    return {
      content: published.content,
      functionName: published.name,
      functionDescription: published.description,
      agentName: agent.name,
    };
  }
}
