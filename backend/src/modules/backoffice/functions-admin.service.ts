import { Injectable } from '@nestjs/common';
import type {
  PreviewFunctionDraftInput,
  AdminFunctionBlockView,
  AdminFunctionTemplateView,
  CreateFunctionBlockInput,
  CreateFunctionTemplateInput,
  SaveFunctionBlockInput,
  SaveFunctionTemplateInput,
} from '@gptmaker/contracts';
import { FunctionCatalog, FunctionSandbox, type SandboxResult } from '../agent-functions';
import { AuditService } from './audit.service';

/**
 * Templates de função e blocos no backoffice (spec admin-backoffice, "Gestão de templates de
 * função"): as regras ficam no `FunctionCatalog`; aqui a auditoria de cada escrita.
 */
@Injectable()
export class FunctionsAdminService {
  constructor(
    private readonly catalog: FunctionCatalog,
    private readonly sandbox: FunctionSandbox,
    private readonly audit: AuditService,
  ) {}

  async createTemplate(
    input: CreateFunctionTemplateInput,
    actorId: string,
  ): Promise<AdminFunctionTemplateView> {
    const view = await this.catalog.createTemplate(input);
    await this.record(actorId, 'function.create', 'function_template', view.code, null, view.draft);
    return view;
  }

  async saveTemplate(
    code: string,
    input: SaveFunctionTemplateInput,
    actorId: string,
  ): Promise<AdminFunctionTemplateView> {
    const before = await this.catalog.getTemplate(code);
    const view = await this.catalog.saveTemplateDraft(code, input);
    await this.record(
      actorId,
      'function.draft',
      'function_template',
      code,
      before.draft,
      view.draft,
    );
    return view;
  }

  async publishTemplate(code: string, actorId: string): Promise<AdminFunctionTemplateView> {
    const before = await this.catalog.getTemplate(code);
    const { version } = await this.catalog.publishTemplate(code, actorId);
    await this.record(
      actorId,
      'function.publish',
      'function_template',
      code,
      { version: before.latestVersion },
      { version },
    );
    return this.catalog.getTemplate(code);
  }

  async restoreVersion(
    code: string,
    version: number,
    actorId: string,
  ): Promise<AdminFunctionTemplateView> {
    const before = await this.catalog.getTemplate(code);
    const restored = await this.catalog.restoreVersion(code, version, actorId);
    await this.record(
      actorId,
      'function.restore',
      'function_template',
      code,
      { version: before.latestVersion, draft: before.draft },
      { version: restored.version, restoredFrom: version, draftRestored: restored.draftRestored },
    );
    return this.catalog.getTemplate(code);
  }

  async setActive(
    code: string,
    active: boolean,
    actorId: string,
  ): Promise<AdminFunctionTemplateView> {
    const before = await this.catalog.getTemplate(code);
    const view = await this.catalog.setActive(code, active);
    if (before.active !== active) {
      await this.record(
        actorId,
        active ? 'function.activate' : 'function.inactivate',
        'function_template',
        code,
        { active: before.active },
        { active },
      );
    }
    return view;
  }

  async remove(code: string, actorId: string): Promise<void> {
    const before = await this.catalog.getTemplate(code);
    await this.catalog.remove(code);
    await this.record(
      actorId,
      'function.delete',
      'function_template',
      code,
      {
        latestVersion: before.latestVersion,
        active: before.active,
      },
      null,
    );
  }

  /** Publica a prévia do rascunho no agente de sandbox (fora de qualquer tenant). */
  async publishSandbox(
    code: string,
    input: PreviewFunctionDraftInput,
    actorId: string,
  ): Promise<SandboxResult> {
    const result = await this.sandbox.publish(code, input);
    await this.record(actorId, 'function.sandbox', 'function_template', code, null, {
      gptmakerAgentId: result.gptmakerAgentId,
      answers: input.answers ?? {},
    });
    return result;
  }

  async createBlock(
    input: CreateFunctionBlockInput,
    actorId: string,
  ): Promise<AdminFunctionBlockView> {
    const view = await this.catalog.createBlock(input);
    await this.record(
      actorId,
      'function-block.create',
      'function_block',
      view.code,
      null,
      view.draft,
    );
    return view;
  }

  async saveBlock(
    code: string,
    input: SaveFunctionBlockInput,
    actorId: string,
  ): Promise<AdminFunctionBlockView> {
    const before = await this.catalog.getBlock(code);
    const view = await this.catalog.saveBlockDraft(code, input);
    await this.record(
      actorId,
      'function-block.draft',
      'function_block',
      code,
      before.draft,
      view.draft,
    );
    return view;
  }

  async publishBlock(code: string, actorId: string): Promise<AdminFunctionBlockView> {
    const before = await this.catalog.getBlock(code);
    const view = await this.catalog.publishBlock(code);
    await this.record(
      actorId,
      'function-block.publish',
      'function_block',
      code,
      before.content,
      view.content,
    );
    return view;
  }

  async removeBlock(code: string, actorId: string): Promise<void> {
    const before = await this.catalog.getBlock(code);
    await this.catalog.removeBlock(code);
    await this.record(
      actorId,
      'function-block.delete',
      'function_block',
      code,
      { name: before.name, publishedAt: before.publishedAt },
      null,
    );
  }

  private record(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    return this.audit.record({ actorId, action, entityType, entityId, before, after });
  }
}
