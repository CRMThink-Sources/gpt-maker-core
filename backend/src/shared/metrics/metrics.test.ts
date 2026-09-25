import { describe, expect, it } from 'vitest';
import { initMetrics, metricsRegistry } from './metrics';

describe('metricsRegistry', () => {
  it('exporta métricas padrão com rótulo do papel', async () => {
    initMetrics('api');
    const text = await metricsRegistry.metrics();
    expect(text).toContain('process_cpu_user_seconds_total');
    expect(text).toContain('role="api"');
  });
});
