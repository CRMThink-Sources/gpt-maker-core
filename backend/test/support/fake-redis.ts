import type Redis from 'ioredis';

/** Subconjunto de Redis em memória para testes unitários (get/set com PX/EX/NX, del, incr, expire, eval). */
export class FakeRedis {
  readonly store = new Map<string, { value: string; expiresAt?: number }>();
  failing = false;

  constructor(private readonly now: () => number = Date.now) {}

  asRedis(): Redis {
    return this as unknown as Redis;
  }

  async get(key: string): Promise<string | null> {
    this.check();
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ...args: (string | number)[]): Promise<'OK' | null> {
    this.check();
    let expiresAt: number | undefined;
    for (let i = 0; i < args.length; i++) {
      const flag = String(args[i]).toUpperCase();
      if (flag === 'PX') expiresAt = this.now() + Number(args[++i]);
      else if (flag === 'EX') expiresAt = this.now() + Number(args[++i]) * 1000;
      else if (flag === 'NX' && (await this.get(key)) !== null) return null;
    }
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    this.check();
    let removed = 0;
    for (const key of keys) if (this.store.delete(key)) removed++;
    return removed;
  }

  async incr(key: string): Promise<number> {
    const next = Number((await this.get(key)) ?? '0') + 1;
    const expiresAt = this.store.get(key)?.expiresAt;
    this.store.set(key, { value: String(next), expiresAt });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.check();
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.expiresAt = this.now() + seconds * 1000;
    return 1;
  }

  /** Só o script de liberação do DistributedLock (GET == token ⇒ DEL). */
  async eval(_script: string, _keys: number, key: string, token: string): Promise<number> {
    if ((await this.get(key)) === token) return this.del(key);
    return 0;
  }

  ttl(key: string): number | undefined {
    const expiresAt = this.store.get(key)?.expiresAt;
    return expiresAt === undefined ? undefined : expiresAt - this.now();
  }

  private check(): void {
    if (this.failing) throw new Error('redis fora do ar');
  }
}
