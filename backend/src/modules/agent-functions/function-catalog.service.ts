import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type AdminFunctionBlockView,
  type AdminFunctionTemplateSummary,
  type AdminFunctionTemplateView,
  type AdminFunctionVersionSummary,
  type AdminFunctionVersionView,
  type AgentFunctionView,
  checkTemplate,
  collapseBlocks,
  compileAgent,
  type CreateFunctionBlockInput,
  createFunctionBlockSchema,
  type CreateFunctionTemplateInput,
  createFunctionTemplateSchema,
  diffLines,
  expandBlocks,
  flattenFields,
  type FunctionBlockContent,
  type FunctionDraftPreview,
  type FunctionField,
  type FunctionTemplateContent,
  type FunctionTemplateDraft,
  type FunctionVersionDiff,
  type PreviewFunctionDraftInput,
  previewFunctionDraftSchema,
  type SaveFunctionBlockInput,
  saveFunctionBlockSchema,
  type SaveFunctionTemplateInput,
  saveFunctionTemplateSchema,
  stableStringify,
  type TemplateCheck,
  validateFunctionAnswers,
} from '@gptmaker/contracts';
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import {
  agent,
  agentFunctionBlock,
  agentFunctionConfig,
  agentFunctionTemplate,
  agentFunctionTemplateVersion,
  backofficeUser,
} from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';

type TemplateRow = typeof agentFunctionTemplate.$inferSelect;
type VersionRow = typeof agentFunctionTemplateVersion.$inferSelect;
type BlockRow = typeof agentFunctionBlock.$inferSelect;

/** Versão publicada que o app usa para compilar um agente. */
export interface PublishedFunction {
  templateId: string;
  code: string;
  name: string;
  description: string;
  versionId: string;
  version: number;
  content: FunctionTemplateContent;
}

export interface PublishOutcome {
  version: number;
  check: TemplateCheck;
}

/**
 * Templates de função e blocos compartilhados (spec agent-function-templates): rascunho editável,
 * versões imutáveis com blocos expandidos (design D3) e checagem antes de publicar.
 */
@Injectable()
export class FunctionCatalog {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Templates --------------------------------------------------------------------------------

  async listTemplates(): Promise<AdminFunctionTemplateSummary[]> {
    const [rows, counts] = await Promise.all([
      this.db
        .select()
        .from(agentFunctionTemplate)
        .where(isNull(agentFunctionTemplate.deletedAt))
        .orderBy(agentFunctionTemplate.code),
      this.agentsByTemplate(),
    ]);
    return rows.map((row) => summary(row, counts.get(row.id) ?? 0));
  }

  async getTemplate(code: string): Promise<AdminFunctionTemplateView> {
    const row = await this.template(code);
    const [versions, counts, published, publishedIntentions] = await Promise.all([
      this.versions(row.id),
      this.agentsByTemplate(),
      this.publishedFields(row.id),
      this.publishedIntentions(row.id),
    ]);
    return {
      ...summary(row, counts.get(row.id) ?? 0),
      draft: row.draft,
      versions,
      published: Object.fromEntries(published),
      publishedIntentions,
    };
  }

  async createTemplate(raw: CreateFunctionTemplateInput): Promise<AdminFunctionTemplateView> {
    const input = createFunctionTemplateSchema.parse(raw);
    const [existing] = await this.db
      .select({ id: agentFunctionTemplate.id })
      .from(agentFunctionTemplate)
      .where(eq(agentFunctionTemplate.code, input.code));
    if (existing) {
      throw new DomainError(
        'FUNCTION_EXISTS',
        // Código de função excluída continua reservado (design D13).
        'Este código já é ou já foi usado por uma função',
        HttpStatus.CONFLICT,
      );
    }
    // A cópia é independente: só o rascunho, sem versões (design D12).
    const draft = input.copyFrom ? (await this.template(input.copyFrom)).draft : input.draft!;
    await this.db.insert(agentFunctionTemplate).values({
      code: input.code,
      name: input.name,
      description: input.description,
      draft,
    });
    return this.getTemplate(input.code);
  }

  async saveTemplateDraft(
    code: string,
    raw: SaveFunctionTemplateInput,
  ): Promise<AdminFunctionTemplateView> {
    const input = saveFunctionTemplateSchema.parse(raw);
    const row = await this.template(code);
    // Id publicado com outro tipo: as respostas guardadas pelos agentes deixariam de servir.
    const published = await this.publishedFields(row.id);
    const changed = flattenFields(input.draft.fields)
      .filter((field) => published.has(field.id) && published.get(field.id)!.kind !== field.kind)
      .map((field) => ({ id: field.id, from: published.get(field.id)!.kind, to: field.kind }));
    if (changed.length) {
      throw new DomainError(
        'FUNCTION_FIELD_LOCKED',
        'Campo já publicado não pode mudar de tipo; crie um campo novo com outro id',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { fields: changed },
      );
    }
    await this.db
      .update(agentFunctionTemplate)
      .set({
        draft: input.draft,
        ...(input.name ? { name: input.name } : {}),
        ...(input.description ? { description: input.description } : {}),
      })
      .where(eq(agentFunctionTemplate.id, row.id));
    return this.getTemplate(code);
  }

  /** Expande os blocos do rascunho e checa; sem erros, grava a próxima versão. */
  async publishTemplate(code: string, operatorId: string | null): Promise<PublishOutcome> {
    const row = await this.template(code);
    const { content, errors: blockErrors } = await this.expand(row);
    const check = checkTemplate(content);
    const errors = [...blockErrors, ...check.errors];
    if (errors.length) {
      throw new DomainError(
        'FUNCTION_TEMPLATE_INVALID',
        'O rascunho tem problemas e não foi publicado',
        HttpStatus.UNPROCESSABLE_ENTITY,
        {
          errors,
          budget: {
            length: check.budget.length,
            fixed: check.budget.fixed,
            markers: check.budget.markers,
          },
        },
      );
    }
    const version = await this.appendVersion(row.id, content, operatorId);
    return { version, check };
  }

  /**
   * Publica o conteúdo de uma versão antiga como nova versão (rollback). O rascunho volta a ser o
   * dessa versão: mantido, a próxima publicação levaria de novo o que se quis desfazer. Quando
   * não dá para remontá-lo (um bloco mudou depois dela), o rascunho fica e `draftRestored` é falso.
   */
  async restoreVersion(
    code: string,
    version: number,
    operatorId: string | null,
  ): Promise<{ version: number; draftRestored: boolean }> {
    const row = await this.template(code);
    const old = await this.versionRow(row.id, version);
    const { published } = await this.publishedBlocks(row.draft.blocks ?? []);
    const draft = collapseBlocks(old.content, row.draft, published);
    return {
      version: await this.appendVersion(row.id, old.content, operatorId, draft),
      draftRestored: draft !== null,
    };
  }

  async getVersion(code: string, version: number): Promise<AdminFunctionVersionView> {
    const row = await this.template(code);
    const versionRow = await this.versionRow(row.id, version);
    const summaries = await this.versions(row.id);
    const summaryRow = summaries.find((item) => item.version === version)!;
    return { ...summaryRow, content: versionRow.content };
  }

  async diffVersions(code: string, from: number, to: number): Promise<FunctionVersionDiff> {
    const row = await this.template(code);
    const [a, b] = await Promise.all([this.versionRow(row.id, from), this.versionRow(row.id, to)]);
    return {
      from,
      to,
      behavior: diffLines(a.content.behavior, b.content.behavior),
      content: diffLines(prettyJson(a.content), prettyJson(b.content)),
    };
  }

  /** Compila o rascunho com respostas de exemplo, sem publicar. */
  async previewDraft(code: string, raw: PreviewFunctionDraftInput): Promise<FunctionDraftPreview> {
    const input = previewFunctionDraftSchema.parse(raw);
    const row = await this.template(code);
    const { content, errors: blockErrors } = await this.expand(row);
    const { answers, issues } = validateFunctionAnswers(content, input.answers as never, {
      partial: true,
    });
    return {
      content,
      compiled: compileAgent({
        content,
        answers,
        agentName: input.agentName,
        mode: input.mode,
        additionalInstructions: input.additionalInstructions,
      }),
      check: checkTemplate(content),
      blockErrors,
      answerIssues: issues,
    };
  }

  /** Funções que o cliente pode escolher: as que têm versão publicada. */
  async listPublished(): Promise<AgentFunctionView[]> {
    const rows = await this.db
      .select()
      .from(agentFunctionTemplate)
      .where(
        and(
          isNotNull(agentFunctionTemplate.latestVersion),
          eq(agentFunctionTemplate.active, true),
          isNull(agentFunctionTemplate.deletedAt),
        ),
      )
      .orderBy(agentFunctionTemplate.code);
    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      description: row.description,
      version: row.latestVersion!,
    }));
  }

  /** Última versão publicada da função; recusa função sem versão. */
  async latestPublished(code: string): Promise<PublishedFunction> {
    const [row] = await this.db
      .select()
      .from(agentFunctionTemplate)
      .where(eq(agentFunctionTemplate.code, code));
    // Inativa ou excluída: fora da criação de agentes (design D13).
    if (!row?.latestVersion || !row.active || row.deletedAt) {
      throw new DomainError(
        'FUNCTION_NOT_AVAILABLE',
        'Esta função não está disponível',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return published(row, await this.versionRow(row.id, row.latestVersion));
  }

  async versionById(versionId: string): Promise<PublishedFunction> {
    const [found] = await this.db
      .select({ template: agentFunctionTemplate, version: agentFunctionTemplateVersion })
      .from(agentFunctionTemplateVersion)
      .innerJoin(
        agentFunctionTemplate,
        eq(agentFunctionTemplate.id, agentFunctionTemplateVersion.templateId),
      )
      .where(eq(agentFunctionTemplateVersion.id, versionId));
    if (!found) throw new Error(`versão de template inexistente: ${versionId}`);
    return published(found.template, found.version);
  }

  async latestOfTemplate(templateId: string): Promise<PublishedFunction> {
    const [row] = await this.db
      .select()
      .from(agentFunctionTemplate)
      .where(eq(agentFunctionTemplate.id, templateId));
    if (!row?.latestVersion) throw new Error(`template sem versão publicada: ${templateId}`);
    return published(row, await this.versionRow(row.id, row.latestVersion));
  }

  /** Ativa ou inativa: inativa sai da criação de agentes; os existentes seguem (design D13). */
  async setActive(code: string, active: boolean): Promise<AdminFunctionTemplateView> {
    const row = await this.template(code);
    await this.db
      .update(agentFunctionTemplate)
      .set({ active })
      .where(eq(agentFunctionTemplate.id, row.id));
    return this.getTemplate(code);
  }

  /** Exclusão lógica, só sem agentes não removidos; o código fica reservado (design D13). */
  async remove(code: string): Promise<void> {
    const row = await this.template(code);
    const agents = (await this.agentsByTemplate()).get(row.id) ?? 0;
    if (agents > 0) {
      throw new DomainError(
        'FUNCTION_IN_USE',
        `${agents} agente(s) usam esta função; inative em vez de excluir`,
        HttpStatus.CONFLICT,
        { agents },
      );
    }
    await this.db
      .update(agentFunctionTemplate)
      .set({ deletedAt: new Date(), active: false })
      .where(eq(agentFunctionTemplate.id, row.id));
  }

  // Blocos -----------------------------------------------------------------------------------

  async listBlocks(): Promise<AdminFunctionBlockView[]> {
    const [rows, templates] = await Promise.all([
      this.db
        .select()
        .from(agentFunctionBlock)
        .where(isNull(agentFunctionBlock.deletedAt))
        .orderBy(agentFunctionBlock.code),
      this.liveTemplateDrafts(),
    ]);
    return rows.map((row) => blockView(row, templates));
  }

  async getBlock(code: string): Promise<AdminFunctionBlockView> {
    const row = await this.block(code);
    return blockView(row, await this.liveTemplateDrafts());
  }

  async createBlock(raw: CreateFunctionBlockInput): Promise<AdminFunctionBlockView> {
    const input = createFunctionBlockSchema.parse(raw);
    const [existing] = await this.db
      .select({ id: agentFunctionBlock.id })
      .from(agentFunctionBlock)
      .where(eq(agentFunctionBlock.code, input.code));
    if (existing) {
      throw new DomainError(
        'FUNCTION_BLOCK_EXISTS',
        // Código de bloco excluído continua reservado, como o das funções.
        'Este código já é ou já foi usado por um bloco',
        HttpStatus.CONFLICT,
      );
    }
    await this.db.insert(agentFunctionBlock).values(input);
    return this.getBlock(input.code);
  }

  async saveBlockDraft(code: string, raw: SaveFunctionBlockInput): Promise<AdminFunctionBlockView> {
    const input = saveFunctionBlockSchema.parse(raw);
    const row = await this.block(code);
    await this.db
      .update(agentFunctionBlock)
      .set({ draft: input.draft, ...(input.name ? { name: input.name } : {}) })
      .where(eq(agentFunctionBlock.id, row.id));
    return this.getBlock(code);
  }

  /** Publica o rascunho do bloco: entra nos templates quando eles publicarem nova versão. */
  async publishBlock(code: string): Promise<AdminFunctionBlockView> {
    const row = await this.block(code);
    await this.db
      .update(agentFunctionBlock)
      .set({ content: row.draft, publishedAt: new Date() })
      .where(eq(agentFunctionBlock.id, row.id));
    return this.getBlock(code);
  }

  /**
   * Exclusão lógica, só sem função que o inclua no rascunho; o código fica reservado. As versões
   * publicadas não mudam: guardam o conteúdo do bloco já expandido.
   */
  async removeBlock(code: string): Promise<void> {
    const row = await this.block(code);
    const { usedBy } = blockView(row, await this.liveTemplateDrafts());
    if (usedBy.length) {
      throw new DomainError(
        'FUNCTION_BLOCK_IN_USE',
        `Usado por ${usedBy.join(', ')}; tire o bloco dessas funções antes de excluir`,
        HttpStatus.CONFLICT,
        { usedBy },
      );
    }
    await this.db
      .update(agentFunctionBlock)
      .set({ deletedAt: new Date() })
      .where(eq(agentFunctionBlock.id, row.id));
  }

  // Internos ---------------------------------------------------------------------------------

  /** Rascunhos das funções não excluídas: dizem quem usa cada bloco. */
  private liveTemplateDrafts() {
    return this.db
      .select({ code: agentFunctionTemplate.code, draft: agentFunctionTemplate.draft })
      .from(agentFunctionTemplate)
      .where(isNull(agentFunctionTemplate.deletedAt));
  }

  private async template(code: string): Promise<TemplateRow> {
    const [row] = await this.db
      .select()
      .from(agentFunctionTemplate)
      .where(and(eq(agentFunctionTemplate.code, code), isNull(agentFunctionTemplate.deletedAt)));
    if (!row)
      throw new DomainError('FUNCTION_NOT_FOUND', 'Função não encontrada', HttpStatus.NOT_FOUND);
    return row;
  }

  private async block(code: string): Promise<BlockRow> {
    const [row] = await this.db
      .select()
      .from(agentFunctionBlock)
      .where(and(eq(agentFunctionBlock.code, code), isNull(agentFunctionBlock.deletedAt)));
    if (!row)
      throw new DomainError(
        'FUNCTION_BLOCK_NOT_FOUND',
        'Bloco não encontrado',
        HttpStatus.NOT_FOUND,
      );
    return row;
  }

  private async versionRow(templateId: string, version: number): Promise<VersionRow> {
    const [row] = await this.db
      .select()
      .from(agentFunctionTemplateVersion)
      .where(
        and(
          eq(agentFunctionTemplateVersion.templateId, templateId),
          eq(agentFunctionTemplateVersion.version, version),
        ),
      );
    if (!row)
      throw new DomainError(
        'FUNCTION_VERSION_NOT_FOUND',
        'Versão não encontrada',
        HttpStatus.NOT_FOUND,
      );
    return row;
  }

  /** Rascunho com os blocos publicados expandidos. */
  private async expand(
    row: TemplateRow,
  ): Promise<{ content: FunctionTemplateContent; errors: string[] }> {
    const { published, unpublished } = await this.publishedBlocks(row.draft.blocks ?? []);
    const { content, errors } = expandBlocks(row.draft, published);
    return {
      content,
      errors: [
        ...[...unpublished].map((code) => `bloco não publicado: ${code}`),
        ...errors.filter(
          (error) => ![...unpublished].some((code) => error === `bloco inexistente: ${code}`),
        ),
      ],
    };
  }

  /** Conteúdo publicado dos blocos, pelo código; os existentes nunca publicados à parte. */
  private async publishedBlocks(
    codes: string[],
  ): Promise<{ published: Map<string, FunctionBlockContent>; unpublished: Set<string> }> {
    const blocks = codes.length
      ? await this.db
          .select()
          .from(agentFunctionBlock)
          .where(and(inArray(agentFunctionBlock.code, codes), isNull(agentFunctionBlock.deletedAt)))
      : [];
    return {
      published: new Map(
        blocks.flatMap((block) => (block.content ? [[block.code, block.content] as const] : [])),
      ),
      // Bloco existente mas nunca publicado tem mensagem própria; o resto vem da expansão.
      unpublished: new Set(blocks.filter((block) => !block.content).map((block) => block.code)),
    };
  }

  /**
   * Próximo número sob lock da linha do template: publicações concorrentes não colidem. Com
   * `draft`, o rascunho é trocado na mesma transação.
   */
  private appendVersion(
    templateId: string,
    content: FunctionTemplateContent,
    operatorId: string | null,
    draft: FunctionTemplateDraft | null = null,
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ latestVersion: agentFunctionTemplate.latestVersion })
        .from(agentFunctionTemplate)
        .where(eq(agentFunctionTemplate.id, templateId))
        .for('update');
      const version = (locked?.latestVersion ?? 0) + 1;
      await tx
        .insert(agentFunctionTemplateVersion)
        .values({ templateId, version, content, publishedBy: operatorId });
      await tx
        .update(agentFunctionTemplate)
        .set({ latestVersion: version, ...(draft ? { draft } : {}) })
        .where(eq(agentFunctionTemplate.id, templateId));
      return version;
    });
  }

  /** Chaves das intenções de todas as versões publicadas: o editor não as deixa renomear. */
  private async publishedIntentions(templateId: string): Promise<string[]> {
    const rows = await this.db
      .select({ content: agentFunctionTemplateVersion.content })
      .from(agentFunctionTemplateVersion)
      .where(eq(agentFunctionTemplateVersion.templateId, templateId));
    return [...new Set(rows.flatMap(({ content }) => content.intentions.map((i) => i.key)))];
  }

  /** Campos de todas as versões publicadas: tipo e valores das opções (design D12). */
  private async publishedFields(
    templateId: string,
  ): Promise<Map<string, { kind: FunctionField['kind']; options: string[] }>> {
    const rows = await this.db
      .select({ content: agentFunctionTemplateVersion.content })
      .from(agentFunctionTemplateVersion)
      .where(eq(agentFunctionTemplateVersion.templateId, templateId));
    const fields = new Map<string, { kind: FunctionField['kind']; options: string[] }>();
    for (const { content } of rows) {
      for (const field of flattenFields(content.fields)) {
        const entry = fields.get(field.id) ?? { kind: field.kind, options: [] };
        if (field.kind === 'CHOICE' || field.kind === 'MULTI_CHOICE') {
          for (const option of field.options) {
            if (!entry.options.includes(option.value)) entry.options.push(option.value);
          }
        }
        fields.set(field.id, entry);
      }
    }
    return fields;
  }

  private async versions(templateId: string): Promise<AdminFunctionVersionSummary[]> {
    const [rows, counts] = await Promise.all([
      this.db
        .select({
          id: agentFunctionTemplateVersion.id,
          version: agentFunctionTemplateVersion.version,
          publishedAt: agentFunctionTemplateVersion.publishedAt,
          publishedBy: backofficeUser.name,
        })
        .from(agentFunctionTemplateVersion)
        .leftJoin(backofficeUser, eq(backofficeUser.id, agentFunctionTemplateVersion.publishedBy))
        .where(eq(agentFunctionTemplateVersion.templateId, templateId))
        .orderBy(desc(agentFunctionTemplateVersion.version)),
      this.db
        .select({ versionId: agentFunctionConfig.versionId, total: sql<number>`count(*)::int` })
        .from(agentFunctionConfig)
        .innerJoin(agent, eq(agent.id, agentFunctionConfig.agentId))
        .where(and(eq(agentFunctionConfig.templateId, templateId), ne(agent.status, 'DELETED')))
        .groupBy(agentFunctionConfig.versionId),
    ]);
    const byVersion = new Map(counts.map((row) => [row.versionId, row.total]));
    return rows.map((row) => ({
      version: row.version,
      publishedAt: row.publishedAt.toISOString(),
      publishedBy: row.publishedBy,
      agents: byVersion.get(row.id) ?? 0,
    }));
  }

  private async agentsByTemplate(): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ templateId: agentFunctionConfig.templateId, total: sql<number>`count(*)::int` })
      .from(agentFunctionConfig)
      .innerJoin(agent, eq(agent.id, agentFunctionConfig.agentId))
      .where(ne(agent.status, 'DELETED'))
      .groupBy(agentFunctionConfig.templateId);
    return new Map(rows.map((row) => [row.templateId, row.total]));
  }
}

function summary(row: TemplateRow, agents: number): AdminFunctionTemplateSummary {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    latestVersion: row.latestVersion,
    active: row.active,
    agents,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function published(template: TemplateRow, version: VersionRow): PublishedFunction {
  return {
    templateId: template.id,
    code: template.code,
    name: template.name,
    description: template.description,
    versionId: version.id,
    version: version.version,
    content: version.content,
  };
}

function blockView(
  row: BlockRow,
  templates: Array<{ code: string; draft: TemplateRow['draft'] }>,
): AdminFunctionBlockView {
  return {
    code: row.code,
    name: row.name,
    draft: row.draft,
    content: row.content,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    usedBy: templates
      .filter((template) => (template.draft.blocks ?? []).includes(row.code))
      .map((t) => t.code),
  };
}

/** JSON com chaves ordenadas e indentado, para o diff entre versões. */
function prettyJson(value: unknown): string {
  return JSON.stringify(JSON.parse(stableStringify(value)), null, 2);
}
