import { Injectable } from '@nestjs/common';

export interface ComponentHealth {
  status: 'up' | 'down';
  [detail: string]: unknown;
}

/**
 * Componentes externos (ex.: GPTMaker) registram aqui seu estado; `GET /health` agrega.
 * Evita que `shared/health` dependa de módulos de domínio.
 */
@Injectable()
export class HealthRegistry {
  private readonly components = new Map<string, () => Promise<ComponentHealth>>();

  register(name: string, check: () => Promise<ComponentHealth>): void {
    this.components.set(name, check);
  }

  async checkAll(): Promise<Record<string, ComponentHealth>> {
    const entries = await Promise.all(
      [...this.components].map(async ([name, check]) => {
        try {
          return [name, await check()] as const;
        } catch (error) {
          return [name, { status: 'down', message: (error as Error).message }] as const;
        }
      }),
    );
    return Object.fromEntries(entries);
  }
}
