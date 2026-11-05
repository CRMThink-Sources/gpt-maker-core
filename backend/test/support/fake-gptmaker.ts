import { GptMakerError } from '../../src/modules/gptmaker/gptmaker.errors';

interface FakeTraining {
  id: string;
  agentId: string;
  type: string;
  text: string | null;
}

interface FakeIntention {
  id: string;
  agentId: string;
  description: string;
  body: unknown;
}

/**
 * GPTMaker em memória para os fluxos que criam e depois listam (treinamentos e intenções): o
 * WireMock só devolve respostas fixas. Implementa os métodos do `GptMakerClient` que os serviços
 * de agente, treinamento e intenção usam; `failOn` derruba a próxima chamada de uma operação.
 */
export class FakeGptMaker {
  agents = new Map<string, { id: string; profile: unknown; settings: Record<string, unknown> }>();
  trainings = new Map<string, FakeTraining>();
  intentions = new Map<string, FakeIntention>();
  /** Regras de transferência por id: agente de origem e corpo enviado (design D17). */
  transferRules = new Map<
    string,
    {
      id: string;
      agentId: string;
      body: { agentId: string; instructions: string; returnOnFinish: boolean };
    }
  >();
  calls: string[] = [];
  private failures = new Map<string, { skip: number; times: number }>();
  private seq = 0;

  /** Depois de `skip` chamadas de `operation`, as `times` seguintes falham (GPTMaker fora). */
  failOn(operation: string, options: { skip?: number; times?: number } = {}): void {
    this.failures.set(operation, { skip: options.skip ?? 0, times: options.times ?? 1 });
  }

  count(operation: string): number {
    return this.calls.filter((call) => call === operation).length;
  }

  reset(): void {
    this.agents.clear();
    this.trainings.clear();
    this.intentions.clear();
    this.transferRules.clear();
    this.calls = [];
    this.failures.clear();
  }

  private call(operation: string): void {
    this.calls.push(operation);
    const failure = this.failures.get(operation);
    if (!failure) return;
    if (failure.skip > 0) {
      failure.skip -= 1;
      return;
    }
    if (failure.times > 0) {
      failure.times -= 1;
      throw new GptMakerError('UNAVAILABLE', operation, 'fora do ar (simulado)', { status: 503 });
    }
  }

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  async createAgent(input: unknown) {
    this.call('agent.create');
    const id = this.id('gm-agent');
    this.agents.set(id, { id, profile: input, settings: {} });
    return { id, name: (input as { name: string }).name };
  }

  async getAgent(agentId: string) {
    this.call('agent.get');
    const agent = this.agents.get(agentId);
    if (!agent)
      throw new GptMakerError('NOT_FOUND', 'agent.get', 'não encontrado', { status: 404 });
    return { id: agentId, name: (agent.profile as { name?: string }).name ?? '', status: 'ACTIVE' };
  }

  async listWorkspaceAgents(page: { page?: number } = {}) {
    this.call('agent.list');
    if ((page.page ?? 0) > 0) return [];
    return [...this.agents.values()].map((agent) => ({
      id: agent.id,
      name: (agent.profile as { name?: string }).name ?? '',
      status: 'ACTIVE',
    }));
  }

  async updateAgent(agentId: string, input: unknown) {
    this.call('agent.update');
    const agent = this.agents.get(agentId);
    if (agent) agent.profile = input;
    return { id: agentId };
  }

  async updateAgentSettings(agentId: string, settings: Record<string, unknown>) {
    this.call('agent.settings.update');
    const agent = this.agents.get(agentId);
    if (agent) agent.settings = { ...agent.settings, ...settings };
  }

  async updateWebhooks() {
    this.call('agent.webhooks.update');
  }

  async deleteAgent(agentId: string) {
    this.call('agent.delete');
    this.agents.delete(agentId);
  }

  async createTraining(agentId: string, input: { type: string; text?: string }) {
    this.call('training.create');
    const id = this.id('tr');
    this.trainings.set(id, { id, agentId, type: input.type, text: input.text ?? null });
    // Como na API real: a criação não devolve o id; ele vem da listagem.
    return { id: null };
  }

  async listTrainings(agentId: string, type: string, page: { page?: number } = {}) {
    this.call('training.list');
    if ((page.page ?? 0) > 0) return [];
    return [...this.trainings.values()]
      .filter((item) => item.agentId === agentId && item.type === type)
      .map((item) => ({ id: item.id, type: item.type, text: item.text }));
  }

  async updateTextTraining(trainingId: string, input: { text: string }) {
    this.call('training.update');
    const item = this.trainings.get(trainingId);
    if (!item)
      throw new GptMakerError('NOT_FOUND', 'training.update', 'não encontrado', { status: 404 });
    item.text = input.text;
  }

  async deleteTraining(trainingId: string) {
    this.call('training.delete');
    this.trainings.delete(trainingId);
  }

  async createIntention(agentId: string, input: { description: string }) {
    this.call('intention.create');
    const id = this.id('int');
    this.intentions.set(id, { id, agentId, description: input.description, body: input });
    return id;
  }

  async listIntentions(agentId: string, page: { page?: number } = {}) {
    this.call('intention.list');
    if ((page.page ?? 0) > 0) return [];
    return [...this.intentions.values()]
      .filter((item) => item.agentId === agentId)
      .map((item) => ({ id: item.id, description: item.description }));
  }

  async updateIntention(intentionId: string, input: { description: string }) {
    this.call('intention.update');
    const item = this.intentions.get(intentionId);
    if (!item)
      throw new GptMakerError('NOT_FOUND', 'intention.update', 'não encontrada', { status: 404 });
    item.description = input.description;
    item.body = input;
  }

  async deleteIntention(intentionId: string) {
    this.call('intention.delete');
    this.intentions.delete(intentionId);
  }

  async listTransferRules(agentId: string) {
    this.call('transferRule.list');
    return [...this.transferRules.values()]
      .filter((rule) => rule.agentId === agentId)
      .map((rule) => ({ id: rule.id, type: 'AGENT' as const, ...rule.body }));
  }

  async createTransferRule(
    agentId: string,
    input: { agentId: string; instructions: string; returnOnFinish: boolean },
  ) {
    this.call('transferRule.create');
    const id = this.id('rule');
    this.transferRules.set(id, { id, agentId, body: { ...input } });
    return id;
  }

  async updateTransferRule(
    agentId: string,
    ruleId: string,
    input: { agentId: string; instructions: string; returnOnFinish: boolean },
  ) {
    this.call('transferRule.update');
    const rule = this.transferRules.get(ruleId);
    if (!rule || rule.agentId !== agentId)
      throw new GptMakerError('NOT_FOUND', 'transferRule.update', 'não encontrada', {
        status: 404,
      });
    rule.body = { ...input };
  }

  async deleteTransferRule(agentId: string, ruleId: string) {
    this.call('transferRule.delete');
    if (this.transferRules.get(ruleId)?.agentId === agentId) this.transferRules.delete(ruleId);
  }
}
