import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

/**
 * Cifra AES-256-GCM para colunas sensíveis. Formato versionado `v1:<iv>:<tag>:<ciphertext>`
 * (base64url), o mesmo prefixo usado pelo crmthink-platform; a versão permite trocar de chave
 * no futuro sem ambiguidade.
 */
export class FieldCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) {
      throw new Error('DATA_ENCRYPTION_KEY deve ter 32 bytes em base64');
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, ciphertext].map((part) => encode(part)).join(':');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, ciphertext] = payload.split(':');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
      throw new Error('Valor cifrado em formato desconhecido');
    }
    const tagBuffer = Buffer.from(tag, 'base64url');
    if (tagBuffer.length !== TAG_BYTES) throw new Error('Valor cifrado em formato desconhecido');
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64url'), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(tagBuffer);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

function encode(part: string | Buffer): string {
  return typeof part === 'string' ? part : part.toString('base64url');
}

let current: FieldCipher | undefined;

/** Configura a cifra usada pelas colunas `encryptedText`; chamado no boot com a chave do ambiente. */
export function configureFieldCipher(base64Key: string): void {
  current = new FieldCipher(base64Key);
}

export function fieldCipher(): FieldCipher {
  if (!current) throw new Error('Cifra de colunas não configurada (configureFieldCipher)');
  return current;
}
