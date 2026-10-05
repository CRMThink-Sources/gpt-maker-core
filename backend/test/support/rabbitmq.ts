import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RabbitMQContainer, type StartedRabbitMQContainer } from '@testcontainers/rabbitmq';

/**
 * RabbitMQ dos testes com os mesmos plugins da infra (`infra/rabbitmq/enabled_plugins`): a
 * imagem oficial não traz o `x-consistent-hash` ligado, e sem ele a API não declara
 * `channel.inbound`.
 */
export function startRabbitMQ(): Promise<StartedRabbitMQContainer> {
  const plugins = readFileSync(
    path.join(__dirname, '../../../infra/rabbitmq/enabled_plugins'),
    'utf8',
  );
  return new RabbitMQContainer('rabbitmq:4-management-alpine')
    .withCopyContentToContainer([{ content: plugins, target: '/etc/rabbitmq/enabled_plugins' }])
    .start();
}
