import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

export type ClientType = 'contact' | 'lead' | 'company';

const PREFIX: Record<ClientType, string> = { contact: 'c', lead: 'l', company: 'o' };
const TYPE_OF: Record<string, ClientType> = { c: 'contact', l: 'lead', o: 'company' };
const FORMAT = /^([clo])(\d{1,12})\.([A-Za-z0-9_-]{22})$/;

/**
 * Referência opaca do cliente (design S6): `<tipo><id>.<assinatura>`, assinada com uma chave
 * por tenant derivada (HKDF) da chave de dados do app. O agente repassa a referência para as
 * ferramentas MCP; adulterada, copiada errado ou de outro tenant ⇒ não valida.
 */
export class ClientRefs {
  constructor(private readonly secret: Buffer) {}

  static fromBase64Key(base64Key: string): ClientRefs {
    return new ClientRefs(Buffer.from(base64Key, 'base64'));
  }

  issue(tenantId: string, type: ClientType, id: number): string {
    const body = `${PREFIX[type]}${id}`;
    return `${body}.${this.sign(tenantId, body).toString('base64url')}`;
  }

  verify(tenantId: string, ref: unknown): { type: ClientType; id: number } | null {
    if (typeof ref !== 'string') return null;
    const match = FORMAT.exec(ref.trim());
    if (!match) return null;
    const [, prefix, id, signature] = match;
    const expected = this.sign(tenantId, `${prefix}${id}`);
    const received = Buffer.from(signature!, 'base64url');
    // Só a forma canônica: 16 bytes viram 22 caracteres e o último carrega bits de enchimento, que
    // o decodificador ignora; sem isso, trocar o último caractere às vezes ainda validava.
    if (received.toString('base64url') !== signature) return null;
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    return { type: TYPE_OF[prefix!]!, id: Number(id) };
  }

  private sign(tenantId: string, body: string): Buffer {
    const key = Buffer.from(hkdfSync('sha256', this.secret, 'crm-client-ref', tenantId, 32));
    return createHmac('sha256', key).update(body).digest().subarray(0, 16);
  }
}
