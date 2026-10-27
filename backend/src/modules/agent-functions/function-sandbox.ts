import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import {
  type CompiledAgent,
  type FunctionAnswers,
  type FunctionTemplateContent,
  flattenFields,
  intentionJsonName,
  type PreviewFunctionDraftInput,
  validateFunctionAnswers,
} from '@gptmaker/contracts';
import { eq } from 'drizzle-orm';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import { workspaceReservedAgent } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import {
  collectAllPages,
  GptMakerClient,
  GptMakerError,
  type GptMakerWriteIntention,
} from '../gptmaker';
import { ModelCatalogService } from '../models';
import { FunctionCatalog } from './function-catalog.service';

const PURPOSE = 'function-sandbox';
const SANDBOX_NAME = '[SANDBOX] Templates de função';

/** Rótulos dos campos obrigatórios visíveis que ficaram sem resposta. */
function missingAnswers(content: FunctionTemplateContent, answers: FunctionAnswers): string[] {
  const labels = new Map(flattenFields(content.fields).map((field) => [field.id, field.label]));
  const { issues } = validateFunctionAnswers(content, answers);
  return issues.flatMap((issue) => {
    const label = labels.get(issue.field);
    return label && issue.message === 'campo obrigatório' ? [label] : [];
  });
}

/** "A", "A e B", "A, B e C". */
function listLabels(labels: string[]): string {
  return labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`
    : labels.join('');
}

export interface SandboxResult {
  gptmakerAgentId: string;
  compiled: CompiledAgent;
}

/**
 * Agente de sandbox dos templates (spec agent-function-templates, "Teste em sandbox"; design D8):
 * um agente do workspace fora de qualquer tenant, criado sob demanda e registrado como reservado
 * (a sincronização não o vê como órfão). Cada publicação substitui tudo nele. As intenções apontam
 * para um endpoint que só simula a ação: nada é gravado em portal nenhum.
 */
@Injectable()
export class FunctionSandbox {
  private readonly logger = new Logger(FunctionSandbox.name);

  constructor(
    private readonly catalog: FunctionCatalog,
    private readonly gptmaker: GptMakerClient,
    private readonly models: ModelCatalogService,
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async publish(code: string, input: PreviewFunctionDraftInput): Promise<SandboxResult> {
    const preview = await this.catalog.previewDraft(code, input);
    const { compiled } = preview;
    if (compiled.errors.length || preview.blockErrors.length) {
      // Quase sempre a causa é resposta faltando na aba Testar (usuário vazio vira texto, ação sem
      // passo): diga quais campos preencher antes dos erros da compilação.
      const missing = missingAnswers(preview.content, (input.answers ?? {}) as FunctionAnswers);
      throw new DomainError(
        'FUNCTION_SANDBOX_INVALID',
        missing.length
          ? `Preencha na aba Testar: ${listLabels(missing)}. Ou use "Preencher com exemplo".`
          : 'A prévia tem problemas; corrija antes de testar no sandbox',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { errors: [...preview.blockErrors, ...compiled.errors] },
      );
    }
    const agentId = await this.ensureAgent(compiled);
    const profile = {
      name: SANDBOX_NAME,
      behavior: compiled.behavior,
      type: compiled.agentType,
      communicationType: compiled.communicationType,
      jobName: compiled.profile.jobName,
      jobDescription: compiled.profile.jobDescription,
      ...(compiled.profile.jobSite ? { jobSite: compiled.profile.jobSite } : {}),
    };
    await this.gptmaker.updateAgent(agentId, profile);
    const model = (await this.models.list()).find((row) => row.isDefault);
    await this.gptmaker.updateAgentSettings(agentId, {
      ...compiled.settings,
      ...(model ? { prefferModel: model.code } : {}),
    });

    // Substitui a base e as intenções inteiras: é um agente de teste.
    const trainings = await collectAllPages(
      (page, pageSize) => this.gptmaker.listTrainings(agentId, 'TEXT', { page, pageSize }),
      100,
      50,
    );
    for (const item of trainings) await this.gptmaker.deleteTraining(item.id);
    for (const item of compiled.trainings) {
      await this.gptmaker.createTraining(agentId, { type: 'TEXT', text: item.text });
    }
    const intentions = await collectAllPages(
      (page, pageSize) => this.gptmaker.listIntentions(agentId, { page, pageSize }),
      100,
      50,
    );
    for (const item of intentions) await this.gptmaker.deleteIntention(item.id);
    for (const item of compiled.intentions) {
      await this.gptmaker.createIntention(agentId, this.remoteIntention(item.key, item.input));
    }
    this.logger.log({ code, agentId }, 'prévia publicada no sandbox');
    return { gptmakerAgentId: agentId, compiled };
  }

  /** Agente reservado; recriado se sumiu do GPTMaker. */
  private async ensureAgent(compiled: CompiledAgent): Promise<string> {
    const [reserved] = await this.db
      .select()
      .from(workspaceReservedAgent)
      .where(eq(workspaceReservedAgent.purpose, PURPOSE));
    if (reserved) {
      try {
        await this.gptmaker.getAgent(reserved.gptmakerAgentId);
        return reserved.gptmakerAgentId;
      } catch (error) {
        if (!(error instanceof GptMakerError && error.kind === 'NOT_FOUND')) throw error;
        await this.db
          .delete(workspaceReservedAgent)
          .where(eq(workspaceReservedAgent.gptmakerAgentId, reserved.gptmakerAgentId));
      }
    }
    const created = await this.gptmaker.createAgent({
      name: SANDBOX_NAME,
      behavior: compiled.behavior,
      type: compiled.agentType,
      communicationType: compiled.communicationType,
      jobName: compiled.profile.jobName,
      jobDescription: compiled.profile.jobDescription,
    });
    await this.db
      .insert(workspaceReservedAgent)
      .values({ gptmakerAgentId: created.id, purpose: PURPOSE });
    return created.id;
  }

  private remoteIntention(
    key: string,
    input: CompiledAgent['intentions'][number]['input'],
  ): GptMakerWriteIntention {
    const fields = input.fields.map((field) => ({
      name: field.name,
      jsonName: intentionJsonName(field.name),
      description: field.description.trim() || field.name,
      type: field.type,
      required: field.required,
    }));
    return {
      description: input.name,
      details: input.whenToUse,
      manualOutput: input.responseMode === 'INSTRUCTIONS',
      ...(input.responseMode === 'INSTRUCTIONS' && input.instructions
        ? { instructions: input.instructions }
        : {}),
      type: 'WEBHOOK',
      httpMethod: 'POST',
      url: `${this.env.API_PUBLIC_URL.replace(/\/+$/, '')}/gptmaker/sandbox-intentions/${key}`,
      fields,
      headers: [],
      params: [],
      requestBody: JSON.stringify({
        fields: Object.fromEntries(
          fields.map((field) => [field.jsonName, `{{${field.jsonName}}}`]),
        ),
      }),
      autoGenerateParams: false,
      autoGenerateBody: false,
      preprocessingMessage: 'DISABLED',
      active: true,
    };
  }
}

/** Intenções do sandbox: respondem como se a ação tivesse rodado, sem tocar em portal nenhum. */
@Controller('gptmaker/sandbox-intentions')
export class SandboxIntentionController {
  @Post(':key')
  @HttpCode(HttpStatus.OK)
  run(@Param('key') key: string, @Body() body: unknown) {
    const fields = (body as { fields?: Record<string, unknown> } | undefined)?.fields ?? {};
    return {
      ok: true,
      message: `Ação "${key}" simulada no sandbox. Campos recebidos: ${JSON.stringify(fields)}`,
      results: [],
    };
  }
}
