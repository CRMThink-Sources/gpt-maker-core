import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { CreatedOperatorView, OperatorRole, OperatorView } from '@gptmaker/contracts';
import { asc, eq, sql } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { backofficeUser } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { hashPassword, temporaryPassword } from './credentials';

export type Operator = typeof backofficeUser.$inferSelect;

export function operatorView(row: Operator): OperatorView {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.active,
    totpConfigured: row.totpSecret !== null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Cadastro de operadores do backoffice. */
@Injectable()
export class OperatorService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findByEmail(email: string): Promise<Operator | undefined> {
    const [row] = await this.db
      .select()
      .from(backofficeUser)
      .where(eq(sql`lower(${backofficeUser.email})`, email.trim().toLowerCase()));
    return row;
  }

  async findById(id: string): Promise<Operator | undefined> {
    const [row] = await this.db.select().from(backofficeUser).where(eq(backofficeUser.id, id));
    return row;
  }

  async list(): Promise<OperatorView[]> {
    const rows = await this.db.select().from(backofficeUser).orderBy(asc(backofficeUser.name));
    return rows.map(operatorView);
  }

  /** Cria com senha temporária (devolvida uma vez); o TOTP é configurado no primeiro login. */
  async create(input: {
    email: string;
    name: string;
    role: OperatorRole;
  }): Promise<CreatedOperatorView> {
    if (await this.findByEmail(input.email)) {
      throw new DomainError(
        'OPERATOR_EXISTS',
        'Já existe um operador com esse e-mail.',
        HttpStatus.CONFLICT,
      );
    }
    const password = temporaryPassword();
    const [row] = await this.db
      .insert(backofficeUser)
      .values({
        email: input.email.trim(),
        name: input.name.trim(),
        role: input.role,
        passwordHash: await hashPassword(password),
      })
      .returning();
    return { operator: operatorView(row!), temporaryPassword: password };
  }

  async update(id: string, changes: { active?: boolean; role?: OperatorRole }): Promise<Operator> {
    const [row] = await this.db
      .update(backofficeUser)
      .set(changes)
      .where(eq(backofficeUser.id, id))
      .returning();
    if (!row) throw notFound();
    return row;
  }

  /** O próximo login pede a configuração do app autenticador de novo (celular perdido). */
  async resetTotp(id: string): Promise<Operator> {
    const [row] = await this.db
      .update(backofficeUser)
      .set({ totpSecret: null })
      .where(eq(backofficeUser.id, id))
      .returning();
    if (!row) throw notFound();
    return row;
  }

  /** Nova senha temporária (esqueceu a senha): devolvida uma vez. */
  async resetPassword(id: string): Promise<string> {
    const password = temporaryPassword();
    const [row] = await this.db
      .update(backofficeUser)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(backofficeUser.id, id))
      .returning({ id: backofficeUser.id });
    if (!row) throw notFound();
    return password;
  }

  async setPassword(id: string, password: string): Promise<void> {
    await this.db
      .update(backofficeUser)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(backofficeUser.id, id));
  }

  async setTotpSecret(id: string, secret: string): Promise<void> {
    await this.db
      .update(backofficeUser)
      .set({ totpSecret: secret })
      .where(eq(backofficeUser.id, id));
  }

  async touchLogin(id: string): Promise<void> {
    await this.db
      .update(backofficeUser)
      .set({ lastLoginAt: new Date() })
      .where(eq(backofficeUser.id, id));
  }

  /** Quantos ADMIN ativos restam (o último não pode ser desativado nem rebaixado). */
  async activeAdmins(): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(backofficeUser)
      .where(sql`${backofficeUser.role} = 'ADMIN' and ${backofficeUser.active}`);
    return row?.total ?? 0;
  }
}

function notFound(): DomainError {
  return new DomainError('OPERATOR_NOT_FOUND', 'Operador não encontrado.', HttpStatus.NOT_FOUND);
}
