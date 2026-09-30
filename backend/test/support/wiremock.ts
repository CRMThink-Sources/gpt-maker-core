import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

export interface StubMapping {
  request: Record<string, unknown>;
  response: { status: number; jsonBody?: unknown; headers?: Record<string, string>; body?: string };
  priority?: number;
}

/** WireMock em container para testes de contrato dos clientes HTTP (GPTMaker, Bitrix, plataforma). */
export class WireMock {
  private constructor(private readonly container: StartedTestContainer) {}

  static async start(): Promise<WireMock> {
    const container = await new GenericContainer('wiremock/wiremock:3.13.1')
      .withExposedPorts(8080)
      .withWaitStrategy(Wait.forHttp('/__admin/health', 8080))
      .start();
    return new WireMock(container);
  }

  get baseUrl(): string {
    return `http://${this.container.getHost()}:${this.container.getMappedPort(8080)}`;
  }

  async stub(mapping: StubMapping): Promise<void> {
    const res = await fetch(`${this.baseUrl}/__admin/mappings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mapping),
    });
    if (!res.ok) throw new Error(`stub recusado: ${res.status} ${await res.text()}`);
  }

  /** Requisições recebidas que não casaram com nenhum stub (contrato divergente). */
  async unmatched(): Promise<unknown[]> {
    const res = await fetch(`${this.baseUrl}/__admin/requests/unmatched`);
    return ((await res.json()) as { requests: unknown[] }).requests;
  }

  async count(method: string, urlPath: string): Promise<number> {
    const res = await fetch(`${this.baseUrl}/__admin/requests/count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, urlPath }),
    });
    return ((await res.json()) as { count: number }).count;
  }

  /** Corpos (JSON) das requisições recebidas em `method urlPath`, na ordem de chegada. */
  async bodies(method: string, urlPath: string): Promise<unknown[]> {
    const res = await fetch(`${this.baseUrl}/__admin/requests/find`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, urlPath }),
    });
    const { requests } = (await res.json()) as { requests: Array<{ body: string }> };
    return requests.map((request) => JSON.parse(request.body) as unknown);
  }

  async reset(): Promise<void> {
    await fetch(`${this.baseUrl}/__admin/reset`, { method: 'POST' });
  }

  async stop(): Promise<void> {
    await this.container.stop();
  }
}
