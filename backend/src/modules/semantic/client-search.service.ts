import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { CrmClientOption, TestClientType } from '@gptmaker/contracts';
import { DomainError } from '../../shared/http/api-exception.filter';
import { BitrixClient, BitrixError } from '../bitrix';
import type { PortalRef } from './field-catalog.service';

export const CLIENT_SEARCH_LIMIT = 10;

type Row = Record<string, unknown>;

const ENTITY_OF: Record<TestClientType, 'CONTACT' | 'LEAD' | 'COMPANY'> = {
  contact: 'CONTACT',
  lead: 'LEAD',
  company: 'COMPANY',
};

/**
 * Busca de clientes do CRM para simular numa conversa de teste (spec agent-test-chat, design
 * T5): contatos, leads e empresas pelo nome; por telefone ou e-mail quando a busca parecer um.
 * Devolve só nome e empresa.
 */
@Injectable()
export class ClientSearchService {
  private readonly logger = new Logger(ClientSearchService.name);

  constructor(private readonly bitrix: BitrixClient) {}

  async search(portal: PortalRef, raw: string): Promise<CrmClientOption[]> {
    const query = raw.trim();
    if (query.length < 2) return [];
    try {
      const byComm = commType(query);
      return byComm ? await this.byComm(portal, byComm, query) : await this.byName(portal, query);
    } catch (error) {
      if (!(error instanceof BitrixError)) throw error;
      this.logger.warn({ err: error }, 'busca de clientes no CRM indisponível');
      throw new DomainError(
        'CRM_UNAVAILABLE',
        'Não foi possível buscar no CRM agora. Tente de novo em instantes',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private async byName(portal: PortalRef, query: string): Promise<CrmClientOption[]> {
    const order = { DATE_MODIFY: 'DESC' };
    const { results } = await this.bitrix.batch(portal.installationId, {
      contact_name: {
        method: 'crm.contact.list',
        params: {
          filter: { '%NAME': query },
          order,
          select: ['ID', 'NAME', 'LAST_NAME', 'COMPANY_ID'],
        },
      },
      contact_last: {
        method: 'crm.contact.list',
        params: {
          filter: { '%LAST_NAME': query },
          order,
          select: ['ID', 'NAME', 'LAST_NAME', 'COMPANY_ID'],
        },
      },
      lead: {
        method: 'crm.lead.list',
        params: {
          filter: { '%TITLE': query },
          order,
          select: ['ID', 'TITLE', 'NAME', 'LAST_NAME', 'COMPANY_TITLE'],
        },
      },
      company: {
        method: 'crm.company.list',
        params: { filter: { '%TITLE': query }, order, select: ['ID', 'TITLE'] },
      },
    });
    const contacts = dedupe([...rows(results.contact_name), ...rows(results.contact_last)]);
    return this.withCompanies(portal, [
      ...contacts.map((row) => ({ type: 'contact' as const, row })),
      ...rows(results.lead).map((row) => ({ type: 'lead' as const, row })),
      ...rows(results.company).map((row) => ({ type: 'company' as const, row })),
    ]);
  }

  private async byComm(
    portal: PortalRef,
    type: 'PHONE' | 'EMAIL',
    query: string,
  ): Promise<CrmClientOption[]> {
    const value = type === 'PHONE' ? query.replace(/\D/g, '') : query.toLowerCase();
    const { result } = await this.bitrix.call<Partial<Record<string, number[]>>>(
      portal.installationId,
      'crm.duplicate.findbycomm',
      { type, values: [value] },
    );
    const found = (['contact', 'lead', 'company'] as const).flatMap((kind) =>
      (result?.[ENTITY_OF[kind]] ?? []).slice(0, CLIENT_SEARCH_LIMIT).map((id) => ({ kind, id })),
    );
    if (!found.length) return [];
    const { results } = await this.bitrix.batch(
      portal.installationId,
      Object.fromEntries(
        found.map(({ kind, id }) => [
          `${kind}_${id}`,
          { method: `crm.${kind}.get`, params: { id } },
        ]),
      ),
    );
    return this.withCompanies(
      portal,
      found
        .map(({ kind, id }) => ({ type: kind, row: results[`${kind}_${id}`] as Row | undefined }))
        .filter((item): item is { type: TestClientType; row: Row } => Boolean(item.row)),
    );
  }

  /** Nome da empresa dos contatos (um `batch`), e corte no limite. */
  private async withCompanies(
    portal: PortalRef,
    items: Array<{ type: TestClientType; row: Row }>,
  ): Promise<CrmClientOption[]> {
    const limited = items.slice(0, CLIENT_SEARCH_LIMIT);
    const companyIds = [
      ...new Set(
        limited
          .filter((item) => item.type === 'contact' && Number(item.row.COMPANY_ID) > 0)
          .map((item) => Number(item.row.COMPANY_ID)),
      ),
    ];
    const companies = new Map<number, string>();
    if (companyIds.length) {
      const { results } = await this.bitrix.batch(
        portal.installationId,
        Object.fromEntries(
          companyIds.map((id) => [`company_${id}`, { method: 'crm.company.get', params: { id } }]),
        ),
      );
      for (const id of companyIds) {
        const title = text((results[`company_${id}`] as Row | undefined)?.TITLE);
        if (title) companies.set(id, title);
      }
    }
    return limited.map(({ type, row }) => ({
      type,
      id: Number(row.ID),
      name: displayName(type, row),
      company:
        type === 'contact'
          ? (companies.get(Number(row.COMPANY_ID)) ?? null)
          : type === 'lead'
            ? text(row.COMPANY_TITLE)
            : null,
    }));
  }
}

/** Telefone (8+ dígitos) ou e-mail; senão, busca por nome. */
export function commType(query: string): 'PHONE' | 'EMAIL' | null {
  if (/^\S+@\S+\.\S+$/.test(query)) return 'EMAIL';
  if (/^[\d\s()+.-]+$/.test(query) && query.replace(/\D/g, '').length >= 8) return 'PHONE';
  return null;
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

function dedupe(items: Row[]): Row[] {
  const seen = new Set<string>();
  return items.filter((row) => {
    const id = String(row.ID);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function displayName(type: TestClientType, row: Row): string {
  const person = [row.NAME, row.LAST_NAME].map(text).filter(Boolean).join(' ');
  if (type === 'company') return text(row.TITLE) ?? `Empresa ${String(row.ID)}`;
  if (type === 'lead') return text(row.TITLE) ?? (person || `Lead ${String(row.ID)}`);
  return person || `Contato ${String(row.ID)}`;
}
