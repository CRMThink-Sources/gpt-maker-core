import { Injectable } from '@nestjs/common';
import {
  isUserList,
  renderFields,
  renderTemplate,
  type SpaItemActionInput,
  type TemplateContext,
  templatesUse,
  type TriggerActionInput,
} from '@gptmaker/contracts';
import { BitrixClient, BitrixError } from '../../bitrix';
import { ActionError } from './action-error';
import { ActionRotation } from './action-rotation';
import {
  bizprocDocumentId,
  type CrmBinding,
  type CrmEntityType,
  parseCrmBinding,
  parseSessionId,
  primaryEntity,
  TASK_CRM_PREFIX,
} from './crm-binding';
import { sendOutboundWebhook } from './outbound-webhook';

/** Campos multivalorados do CRM: o template dá um texto, o Bitrix quer `[{VALUE, VALUE_TYPE}]`. */
const MULTI_FIELDS = new Set(['PHONE', 'EMAIL', 'WEB', 'IM']);

/** Ações dos gatilhos e as que só existem nas intenções (item de SPA). */
export type ExecutableAction = (TriggerActionInput | SpaItemActionInput) & {
  id: string;
  secret: string | null;
};

/** Diálogo da Linha Aberta lido no Bitrix: vínculo com o CRM e sessão atual. */
interface DialogInfo {
  crm: CrmBinding;
  sessionId: string | null;
}

/** Campo de um item de SPA (`crm.item.fields`), o que a tradução das listas precisa. */
interface SpaFieldMeta {
  type?: string;
  items?: Array<{ ID?: number | string; VALUE?: string; XML_ID?: string }>;
}

export interface ActionContext {
  installationId: number;
  agentEventId: string;
  /** Diálogo da Linha Aberta, quando o evento trouxe; as ações de CRM do diálogo precisam dele. */
  dialogId: string | null;
  template: TemplateContext;
}

export type ActionResult = Record<string, unknown>;

function toCrmFields(fields: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== '')
      .map(([key, value]) => [
        key,
        MULTI_FIELDS.has(key.toUpperCase()) ? [{ VALUE: value, VALUE_TYPE: 'WORK' }] : value,
      ]),
  );
}

/**
 * Executa uma ação de gatilho no portal do tenant (spec agent-triggers: ações suportadas), com os
 * templates resolvidos no contexto do evento. A entidade do CRM do diálogo é lida uma vez por
 * execução (`imopenlines.dialog.get`, campo `entity_data_2`). Erro do Bitrix transitório ⇒
 * `ActionError` transitório; recusa do Bitrix ou falta de dado (diálogo sem entidade) ⇒ definitivo.
 */
@Injectable()
export class TriggerActionExecutor {
  /** Troca nos testes. */
  webhookDeps: Parameters<typeof sendOutboundWebhook>[1] = {};

  constructor(
    private readonly bitrix: BitrixClient,
    private readonly rotation: ActionRotation,
  ) {}

  async execute(action: ExecutableAction, context: ActionContext): Promise<ActionResult> {
    const dialog = lazy(() => this.dialogInfo(context));
    try {
      return await this.run(action, context, dialog);
    } catch (error) {
      if (error instanceof ActionError) throw error;
      if (error instanceof BitrixError) {
        throw new ActionError(error.message, { transient: error.isTransient, cause: error });
      }
      throw new ActionError(error instanceof Error ? error.message : String(error), {
        transient: true,
        cause: error,
      });
    }
  }

  private async run(
    action: ExecutableAction,
    context: ActionContext,
    dialog: () => Promise<DialogInfo>,
  ): Promise<ActionResult> {
    const { installationId, template } = context;
    const binding = async () => (await dialog()).crm;
    switch (action.type) {
      case 'CREATE_LEAD': {
        const { result } = await this.bitrix.call<number>(installationId, 'crm.lead.add', {
          fields: toCrmFields(renderFields(action.config.fields, template)),
          params: { REGISTER_SONET_EVENT: 'Y' },
        });
        return { leadId: Number(result) };
      }

      case 'UPSERT_DEAL': {
        const fields = toCrmFields(renderFields(action.config.fields, template));
        const crm = context.dialogId ? await binding() : {};
        if (crm.deal) {
          // Funil não muda num negócio existente; a etapa precisa ser do funil dele.
          await this.bitrix.call(installationId, 'crm.deal.update', {
            id: crm.deal,
            fields: { ...fields, STAGE_ID: action.config.stageId },
            params: { REGISTER_HISTORY_EVENT: 'Y' },
          });
          return { dealId: crm.deal, created: false };
        }
        const { result } = await this.bitrix.call<number>(installationId, 'crm.deal.add', {
          fields: {
            ...fields,
            CATEGORY_ID: action.config.categoryId,
            STAGE_ID: action.config.stageId,
            ...(crm.contact ? { CONTACT_ID: crm.contact } : {}),
            ...(crm.company ? { COMPANY_ID: crm.company } : {}),
          },
          params: { REGISTER_SONET_EVENT: 'Y' },
        });
        return { dealId: Number(result), created: true };
      }

      case 'TIMELINE_COMMENT': {
        const entity = primaryEntity(await this.requireBinding(context, binding));
        if (!entity) throw noCrmEntity();
        const { result } = await this.bitrix.call<number>(
          installationId,
          'crm.timeline.comment.add',
          {
            fields: {
              ENTITY_ID: entity.id,
              ENTITY_TYPE: entity.type,
              COMMENT: renderTemplate(action.config.text, template),
            },
          },
        );
        return { commentId: Number(result), entityType: entity.type, entityId: entity.id };
      }

      case 'CREATE_TASK': {
        const entity = context.dialogId ? primaryEntity(await binding()) : null;
        const deadline =
          action.config.deadlineDays !== undefined
            ? new Date(Date.now() + action.config.deadlineDays * 86_400_000).toISOString()
            : undefined;
        const { result } = await this.bitrix.call<{ task?: { id?: number | string } }>(
          installationId,
          'tasks.task.add',
          {
            fields: {
              TITLE: renderTemplate(action.config.title, template),
              ...(action.config.description
                ? { DESCRIPTION: renderTemplate(action.config.description, template) }
                : {}),
              // Vários responsáveis: o próximo da lista (D15).
              RESPONSIBLE_ID: isUserList(action.config.responsibleId)
                ? await this.rotation.next(action.id, action.config.responsibleId)
                : action.config.responsibleId,
              ...(deadline ? { DEADLINE: deadline } : {}),
              ...(entity ? { UF_CRM_TASK: [`${TASK_CRM_PREFIX[entity.type]}_${entity.id}`] } : {}),
            },
          },
        );
        return { taskId: Number(result?.task?.id) };
      }

      case 'START_BIZPROC': {
        const type = action.config.documentType.toLowerCase() as CrmEntityType;
        const id = (await this.requireBinding(context, binding))[type];
        if (!id) {
          throw new ActionError(`diálogo sem ${action.config.documentType} vinculado no CRM`, {
            transient: false,
          });
        }
        const { result } = await this.bitrix.call<string>(
          installationId,
          'bizproc.workflow.start',
          {
            TEMPLATE_ID: action.config.templateId,
            DOCUMENT_ID: bizprocDocumentId(type, id),
            PARAMETERS: action.config.parameters
              ? renderFields(action.config.parameters, template)
              : {},
          },
        );
        return { workflowId: String(result), entityType: type, entityId: id };
      }

      case 'CREATE_SPA_ITEM':
        return this.createSpaItem(action.config, context, dialog);

      case 'OUTBOUND_WEBHOOK': {
        if (!action.secret) {
          throw new ActionError('webhook de saída sem segredo', { transient: false });
        }
        const { status } = await sendOutboundWebhook(
          {
            url: action.config.url,
            secret: action.secret,
            event: template.event.name,
            body: {
              event: template.event.name,
              agentEventId: context.agentEventId,
              occurredAt: template.event.date,
              agent: template.agent,
              dialogId: template.dialog.id,
              contact: template.contact,
              message: template.message,
              payload: template.payload,
            },
          },
          this.webhookDeps,
        );
        return { status };
      }
    }
  }

  private async requireBinding(
    context: ActionContext,
    binding: () => Promise<CrmBinding>,
  ): Promise<CrmBinding> {
    if (!context.dialogId) {
      throw new ActionError('evento sem diálogo da Linha Aberta', { transient: false });
    }
    return binding();
  }

  private async dialogInfo(context: ActionContext): Promise<DialogInfo> {
    const { result } = await this.bitrix.call<{ entity_data_1?: unknown; entity_data_2?: unknown }>(
      context.installationId,
      'imopenlines.dialog.get',
      { DIALOG_ID: context.dialogId },
    );
    return {
      crm: parseCrmBinding(result?.entity_data_2),
      sessionId: parseSessionId(result?.entity_data_1),
    };
  }

  /**
   * Item num processo inteligente (`crm.item.add`). A sessão da Linha Aberta só é lida quando um
   * texto a cita. Campo lista recebe o id do item: pela ligação feita no formulário, senão pelo
   * item de mesmo valor ou id externo; sem correspondência, sai do item e vira aviso.
   */
  private async createSpaItem(
    config: SpaItemActionInput['config'],
    context: ActionContext,
    dialog: () => Promise<DialogInfo>,
  ): Promise<ActionResult> {
    const { installationId } = context;
    let template = context.template;
    if (
      context.dialogId &&
      templatesUse([config.title, ...Object.values(config.fields)], 'dialog.sessionId')
    ) {
      const { sessionId } = await dialog();
      template = { ...template, dialog: { ...template.dialog, sessionId } };
    }
    const values = Object.entries(renderFields(config.fields, template))
      .map(([code, value]) => [code, value.trim()] as const)
      .filter(([, value]) => value !== '');
    const meta = values.length ? await this.spaFields(installationId, config.entityTypeId) : {};
    const fields: Record<string, unknown> = {};
    const warnings: string[] = [];
    for (const [code, value] of values) {
      const field = meta[code];
      if (field?.type !== 'enumeration') {
        fields[code] = value;
        continue;
      }
      const id = config.lists?.[code]?.[value] ?? listItemId(field, value);
      if (id) fields[code] = id;
      else warnings.push(`"${value}" não é um item da lista ${code}; o campo ficou vazio`);
    }
    const title = renderTemplate(config.title, template).trim();
    const { result } = await this.bitrix.call<{ item?: { id?: number | string } }>(
      installationId,
      'crm.item.add',
      {
        entityTypeId: config.entityTypeId,
        fields: {
          ...fields,
          ...(title ? { title } : {}),
          ...(config.categoryId !== undefined ? { categoryId: config.categoryId } : {}),
          ...(config.stageId ? { stageId: config.stageId } : {}),
        },
      },
    );
    return {
      itemId: Number(result?.item?.id),
      entityTypeId: config.entityTypeId,
      ...(warnings.length ? { warnings } : {}),
    };
  }

  private async spaFields(
    installationId: number,
    entityTypeId: number,
  ): Promise<Record<string, SpaFieldMeta>> {
    const { result } = await this.bitrix.call<{ fields?: Record<string, SpaFieldMeta> }>(
      installationId,
      'crm.item.fields',
      { entityTypeId },
    );
    return result?.fields ?? {};
  }
}

const noCrmEntity = () =>
  new ActionError('diálogo sem entidade vinculada no CRM', { transient: false });

/** Item da lista com o mesmo valor ou id externo, sem diferenciar maiúsculas. */
function listItemId(field: SpaFieldMeta, value: string): number | undefined {
  const wanted = value.toLowerCase();
  const item = (field.items ?? []).find(
    (candidate) =>
      candidate.VALUE?.trim().toLowerCase() === wanted ||
      candidate.XML_ID?.trim().toLowerCase() === wanted,
  );
  const id = Number(item?.ID);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/** Uma chamada só, e só se alguém pedir. */
function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | undefined;
  return () => (promise ??= load());
}
