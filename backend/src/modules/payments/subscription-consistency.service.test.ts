import type { CurrentSubscription } from '@crmthink-sources/platform-sdk';
import { describe, expect, it } from 'vitest';
import type { subscriptionState } from '../../shared/database/schema/index';
import { reconcile } from './subscription-consistency.service';

type Projection = typeof subscriptionState.$inferSelect;

const NOW = new Date('2026-11-10T12:00:00Z');

function local(values: Partial<Projection>): Projection {
  return {
    tenantId: 't',
    subscriptionId: '155',
    status: 'active',
    modality: 'stripe',
    planId: '11',
    nextPlanId: null,
    periodStart: new Date('2026-10-03T00:00:00Z'),
    periodEnd: new Date('2026-11-03T23:59:59Z'),
    version: 2,
    graceUntil: null,
    cancelAt: null,
    updatedAt: NOW,
    ...values,
  };
}

function remote(values: Partial<CurrentSubscription>): CurrentSubscription {
  return {
    subscriptionId: 155,
    status: 'active',
    modality: 'stripe',
    plan: { id: 11 },
    periodStart: '2026-10-03T00:00:00.000Z',
    periodEnd: '2026-11-03T23:59:59.999Z',
    cancelAtPeriodEnd: false,
    trial: { used: true, endsAt: null },
    version: 2,
    ...values,
  } as CurrentSubscription;
}

describe('reconcile (consistência da projeção)', () => {
  it('iguais: nada a fazer', () => {
    expect(reconcile(local({}), remote({}), NOW)).toBeNull();
    expect(reconcile(undefined, null, NOW)).toBeNull();
  });

  it('trial que nunca chegou: trial_started com o fim do trial', () => {
    const result = reconcile(
      undefined,
      remote({ status: 'trialing', trial: { used: true, endsAt: '2026-10-17T23:59:59.999Z' } }),
      NOW,
    );
    expect(result).toMatchObject({
      type: 'subscription.trial_started',
      subscription: { id: 155, status: 'trialing', version: 2 },
      data: { trialEndsAt: '2026-10-17T23:59:59.999Z' },
    });
  });

  it('assinatura paga nova (outra assinatura ou nenhuma local): activated', () => {
    expect(
      reconcile(local({ subscriptionId: '153', status: 'trialing' }), remote({}), NOW),
    ).toMatchObject({
      type: 'subscription.activated',
      subscription: { id: 155, planId: 11 },
    });
  });

  it('período mais novo: renewed', () => {
    const result = reconcile(
      local({}),
      remote({
        version: 4,
        periodStart: '2026-11-03T00:00:00.000Z',
        periodEnd: '2026-12-03T23:59:59.999Z',
      }),
      NOW,
    );
    expect(result).toMatchObject({
      type: 'subscription.renewed',
      subscription: { periodStart: '2026-11-03T00:00:00.000Z' },
    });
  });

  it('inadimplência e regularização sem evento', () => {
    expect(reconcile(local({}), remote({ status: 'past_due', version: 3 }), NOW)).toMatchObject({
      type: 'subscription.past_due',
    });
    expect(
      reconcile(local({ status: 'past_due' }), remote({ status: 'active', version: 3 }), NOW),
    ).toMatchObject({ type: 'subscription.recovered' });
  });

  it('versão local igual ou maior: nada (evento já aplicado ou mais novo aqui)', () => {
    expect(
      reconcile(local({ version: 5 }), remote({ status: 'past_due', version: 5 }), NOW),
    ).toBeNull();
  });

  it('sem assinatura na plataforma depois do fim do período: ended', () => {
    expect(reconcile(local({}), null, NOW)).toMatchObject({
      type: 'subscription.ended',
      subscription: { id: 155, status: 'cancelled' },
      data: { reason: 'cancelled' },
    });
    expect(
      reconcile(
        local({ status: 'trialing', periodEnd: new Date('2026-10-17T23:59:59Z') }),
        null,
        NOW,
      ),
    ).toMatchObject({ data: { reason: 'trial_expired' } });
  });

  it('sem assinatura na plataforma antes do fim do período: só alerta', () => {
    expect(reconcile(local({}), null, new Date('2026-11-04T12:00:00Z'))).toEqual({
      alert: expect.any(String),
    });
  });

  it('assinatura local já encerrada e nada na plataforma: nada', () => {
    expect(reconcile(local({ status: 'cancelled' }), null, NOW)).toBeNull();
  });
});
