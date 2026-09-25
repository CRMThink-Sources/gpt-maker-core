import { customType, timestamp } from 'drizzle-orm/pg-core';
import { fieldCipher } from '../crypto/field-cipher';

/** Texto cifrado com AES-256-GCM em repouso; a aplicação lê e grava o valor em claro. */
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType: () => 'text',
  toDriver: (value) => fieldCipher().encrypt(value),
  fromDriver: (value) => fieldCipher().decrypt(value),
});

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAt = () => timestamptz('created_at').notNull().defaultNow();

export const updatedAt = () =>
  timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
