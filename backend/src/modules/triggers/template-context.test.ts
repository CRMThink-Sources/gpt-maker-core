import { renderTemplate } from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import { buildTemplateContext } from './template-context';

const agent = { id: 'a1', name: 'ThinkFlow AI' };
const receivedAt = new Date('2026-10-01T17:26:56.376Z');

// Payloads reais capturados em 2026-10-01 (docs/gptmaker-api.md §5.4.1), com valores trocados.
const newMessage = {
  date: '2026-10-01T17:26:53.388+00:00',
  role: 'user',
  audios: [],
  images: [],
  channel: 'API',
  message: 'Boa tarde',
  contextId: 'public-api-GM1-t1:chat9498',
  documents: [],
  messageId: 'M1',
  assistantId: 'GM1',
  contactName: 'Maria',
  contactPhone: null,
};
const firstInteraction = {
  name: 'Maria',
  agentId: 'GM1',
  channel: 'API',
  protocol: 1005,
  channelId: 'C1',
  contextId: 'public-api-GM1-t1:chat9498',
  recipient: 't1:chat9498',
  interactionId: 'I1',
};

describe('contexto dos templates', () => {
  it('onNewMessage', () => {
    const context = buildTemplateContext(
      { event: 'onNewMessage', dialogId: 'chat9498', payload: newMessage, receivedAt },
      agent,
    );
    expect(context).toMatchObject({
      contact: { name: 'Maria', phone: null },
      message: { text: 'Boa tarde', role: 'user' },
      agent,
      event: { name: 'onNewMessage', date: '2026-10-01T17:26:56.376Z' },
      dialog: { id: 'chat9498' },
      interaction: { id: null, protocol: null },
    });
    expect(
      renderTemplate('{{contact.name}}: {{message.text}} ({{payload.channel}})', context),
    ).toBe('Maria: Boa tarde (API)');
  });

  it('onFirstInteraction: nome em outro campo, protocolo numérico', () => {
    const context = buildTemplateContext(
      { event: 'onFirstInteraction', dialogId: 'chat9498', payload: firstInteraction, receivedAt },
      agent,
    );
    expect(context).toMatchObject({
      contact: { name: 'Maria', phone: null },
      message: { text: null, role: null },
      interaction: { id: 'I1', protocol: '1005' },
    });
  });

  it('payload em formato inesperado', () => {
    const context = buildTemplateContext(
      {
        event: 'onTransfer',
        dialogId: null,
        payload: { raw: 'x', contentType: 'text/plain' },
        receivedAt,
      },
      agent,
    );
    expect(context.contact).toEqual({ name: null, phone: null });
    expect(renderTemplate('{{contact.name | "cliente"}}', context)).toBe('cliente');
  });
});
