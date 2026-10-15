import { Inject, Injectable } from '@nestjs/common';
import type { CrmEntity } from '@gptmaker/contracts';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { crmFieldSetting } from '../../shared/database/schema/index';
import { type FieldChoice, FieldChoices } from './semantic-translator';

/** Escolhas do cliente sobre os campos do CRM (tabela `crm_field_setting`), sempre por tenant. */
@Injectable()
export class FieldSettingsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async forTenant(tenantId: string): Promise<FieldChoices> {
    const rows = await this.db
      .select()
      .from(crmFieldSetting)
      .where(eq(crmFieldSetting.tenantId, tenantId));
    return new FieldChoices(
      new Map(
        rows.map((row) => [
          FieldChoices.key(row.entity, row.fieldCode),
          { exposed: row.exposed, description: row.description },
        ]),
      ),
    );
  }

  async save(tenantId: string, entity: CrmEntity, code: string, choice: FieldChoice) {
    await this.db
      .insert(crmFieldSetting)
      .values({ tenantId, entity, fieldCode: code, ...choice })
      .onConflictDoUpdate({
        target: [crmFieldSetting.tenantId, crmFieldSetting.entity, crmFieldSetting.fieldCode],
        set: { ...choice, updatedAt: new Date() },
      });
  }
}
