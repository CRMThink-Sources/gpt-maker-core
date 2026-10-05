import { Injectable } from '@nestjs/common';
import {
  renderFields,
  renderTemplate,
  type TemplateContext,
  type TriggerActionInput,
} from '@gptmaker/contracts';
import { BitrixClient, BitrixError } from '../../bitrix';
import { ActionError } from './action-error';
import {
  bizprocDocumentId,
  type CrmBinding,
  type CrmEntityType,
  parseCrmBinding,
  primaryEntity,
  TASK_CRM_PREFIX,
} from './crm-binding';
import { sendOutboundWebhook } from './outbound-webhook';

/** Campos multivalorados do CRM: o template dá um texto, o Bitrix quer `[{VALUE, VALUE_TYPE}]`. */
const MULTI_FIELDS = new Set(['PHONE', 'EMAIL', 'WEB', 'IM']);

export type ExecutableAction = TriggerActionInput & { id: string; secret: string | null };

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

  constructor(private readonly bitrix: BitrixClient) {}

  async execute(action: ExecutableAction, context: ActionContext): Promise<ActionResult> {
    const binding = lazy(() => this.crmBinding(context));
    try {
      return await this.run(action, context, binding);
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
    binding: () => Promise<CrmBinding>,
  ): Promise<ActionResult> {
    const { installationId, template } = context;
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
              RESPONSIBLE_ID: action.config.responsibleId,
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

  private async crmBinding(context: ActionContext): Promise<CrmBinding> {
    const { result } = await this.bitrix.call<{ entity_data_2?: unknown }>(
      context.installationId,
      'imopenlines.dialog.get',
      { DIALOG_ID: context.dialogId },
    );
    return parseCrmBinding(result?.entity_data_2);
  }
}

const noCrmEntity = () =>
  new ActionError('diálogo sem entidade vinculada no CRM', { transient: false });

/** Uma chamada só, e só se alguém pedir. */
function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | undefined;
  return () => (promise ??= load());
}
