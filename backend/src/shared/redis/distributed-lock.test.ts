import { describe, expect, it } from 'vitest';
import { FakeRedis } from '../../../test/support/fake-redis';
import { DistributedLock } from './distributed-lock';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('DistributedLock', () => {
  it('runExclusive não espera: com o lock ocupado, não roda', async () => {
    const lock = new DistributedLock(new FakeRedis().asRedis());
    const order: string[] = [];
    const first = lock.runExclusive('k', 5000, async () => {
      order.push('a');
      await sleep(50);
      return 'a';
    });
    await sleep(5);
    const second = await lock.runExclusive('k', 5000, async () => 'b');
    expect(second).toEqual({ ran: false });
    expect(await first).toEqual({ ran: true, result: 'a' });
  });

  it('runExclusiveWaiting espera o lock e roda em seguida, sem sobreposição', async () => {
    const lock = new DistributedLock(new FakeRedis().asRedis());
    const log: string[] = [];
    const work = (name: string) => async () => {
      log.push(`${name}:início`);
      await sleep(40);
      log.push(`${name}:fim`);
      return name;
    };
    const [a, b] = await Promise.all([
      lock.runExclusiveWaiting('k', 5000, 2000, work('a'), 10),
      lock.runExclusiveWaiting('k', 5000, 2000, work('b'), 10),
    ]);
    expect([a, b].every((outcome) => outcome.ran)).toBe(true);
    // Nunca dois "início" seguidos: um termina antes de o outro começar.
    expect(log).toHaveLength(4);
    expect(log[0]!.split(':')[0]).toBe(log[1]!.split(':')[0]);
    expect(log[2]!.split(':')[0]).toBe(log[3]!.split(':')[0]);
  });

  it('runExclusiveWaiting desiste depois do tempo de espera', async () => {
    const lock = new DistributedLock(new FakeRedis().asRedis());
    const holder = lock.runExclusive('k', 5000, () => sleep(200));
    await sleep(5);
    const started = Date.now();
    const outcome = await lock.runExclusiveWaiting('k', 5000, 60, async () => 'x', 10);
    expect(outcome).toEqual({ ran: false });
    expect(Date.now() - started).toBeLessThan(180);
    await holder;
  });

  it('o lock é liberado mesmo se a função falhar', async () => {
    const lock = new DistributedLock(new FakeRedis().asRedis());
    await expect(
      lock.runExclusive('k', 5000, async () => {
        throw new Error('falhou');
      }),
    ).rejects.toThrow('falhou');
    await expect(lock.runExclusive('k', 5000, async () => 'ok')).resolves.toEqual({
      ran: true,
      result: 'ok',
    });
  });
});
