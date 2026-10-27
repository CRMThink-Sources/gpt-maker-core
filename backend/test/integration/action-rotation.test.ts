import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActionRotation } from '../../src/modules/triggers/actions/action-rotation';

// Rodízio de usuários numa ação (design D15).
describe('rodízio de usuários', () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let rotation: ActionRotation;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis(container.getConnectionUrl());
    rotation = new ActionRotation(redis);
  });

  afterAll(async () => {
    redis?.disconnect();
    await container?.stop();
  });

  it('gira pela lista e volta ao primeiro', async () => {
    const picks = [];
    for (let index = 0; index < 4; index++) picks.push(await rotation.next('a', [1, 2, 3]));
    expect(picks).toEqual([1, 2, 3, 1]);
  });

  it('um usuário só: devolve sem contar', async () => {
    expect(await rotation.next('b', [7])).toBe(7);
    expect(await redis.exists('rotation:b')).toBe(0);
  });

  it('cada ação tem a sua contagem', async () => {
    expect(await rotation.next('c', [4, 5])).toBe(4);
    expect(await rotation.next('d', [8, 9])).toBe(8);
    expect(await rotation.next('c', [4, 5])).toBe(5);
  });
});
