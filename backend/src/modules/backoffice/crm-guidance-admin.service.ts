import { Injectable } from '@nestjs/common';
import type { CrmGuidanceView } from '@gptmaker/contracts';
import { type CrmGuidanceChange, CrmGuidanceService } from '../crm-tools';
import { AuditService } from './audit.service';

/**
 * Orientações das ferramentas do CRM no backoffice: as regras (padrão no código, cache) ficam no
 * `CrmGuidanceService`; aqui só a auditoria com o texto anterior e o novo.
 */
@Injectable()
export class CrmGuidanceAdminService {
  constructor(
    private readonly guidance: CrmGuidanceService,
    private readonly audit: AuditService,
  ) {}

  list(): Promise<CrmGuidanceView[]> {
    return this.guidance.list();
  }

  async save(key: string, text: string, actor: string): Promise<CrmGuidanceView[]> {
    const change = await this.guidance.save(key, text, actor);
    await this.record(actor, 'crm_guidance.updated', key, change);
    return this.guidance.list();
  }

  async reset(key: string, actor: string): Promise<CrmGuidanceView[]> {
    const change = await this.guidance.reset(key);
    await this.record(actor, 'crm_guidance.reset', key, change);
    return this.guidance.list();
  }

  private record(actor: string, action: string, key: string, change: CrmGuidanceChange) {
    return this.audit.record({
      actorId: actor,
      action,
      entityType: 'crm_guidance',
      entityId: key,
      before: { text: change.before },
      after: { text: change.after },
    });
  }
}
