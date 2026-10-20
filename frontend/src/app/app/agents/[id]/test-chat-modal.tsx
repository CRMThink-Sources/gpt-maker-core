'use client';

import {
  AGENT_TEST_CONVERSATIONS_MAX,
  AGENT_TEST_MESSAGE_MAX,
  type CrmAccessView,
  type CrmClientOption,
  TEST_CLIENT_TYPE_LABELS,
  type TestClient,
  type TestConversationSummary,
  type TestConversationView,
  type TestMessageView,
} from '@gptmaker/contracts';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeftIcon, ChatIcon, PlusIcon, SendIcon, TrashIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, buttonClass, Spinner } from '@/components/ui';
import {
  agentTestErrorMessage,
  createTestConversation,
  CRM_CLIENT_SEARCH_MIN,
  deleteTestConversation,
  formatWhen,
  getTestConversation,
  listTestConversations,
  noCredit,
  searchCrmClients,
  sendTestMessage,
} from '@/lib/agent-tests';
import { getCrmAccess } from '@/lib/crm';
import { ApiRequestError } from '@/lib/platform-session';
import { useAppSession } from '../../session-provider';
import { useAgent } from './agent-context';

/** A partir de quantos caracteres o contador do campo aparece. */
const COUNTER_FROM = AGENT_TEST_MESSAGE_MAX - 500;
const SEARCH_DEBOUNCE_MS = 300;

type AccessState = 'loading' | 'connected' | 'off' | 'unavailable';

function clientLabel(client: TestClient): string {
  return `${client.name} (${TEST_CLIENT_TYPE_LABELS[client.type]})`;
}

function accessState(view: CrmAccessView): AccessState {
  if (!view.available) return 'unavailable';
  return view.status === 'CONNECTED' ? 'connected' : 'off';
}

/** Modal "Testar agente": conversas de teste guardadas no backend (spec agent-test-chat). */
export function TestChatModal({ onClose }: { onClose: () => void }) {
  const { session, api } = useAppSession();
  const { agent } = useAgent();
  const featureOn = session.features?.crmTools === true;

  const [conversations, setConversations] = useState<TestConversationSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessState>(featureOn ? 'loading' : 'unavailable');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<TestConversationView | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  /** Telas pequenas: lista e conversa se alternam. */
  const [pane, setPane] = useState<'list' | 'chat'>('list');
  /** Passo "Simular cliente do CRM" aberto na coluna da direita. */
  const [choosingClient, setChoosingClient] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [text, setText] = useState('');
  /** Envio em andamento (uma resposta por vez). */
  const [sending, setSending] = useState<{ conversationId: string; text: string } | null>(null);
  const [sendError, setSendError] = useState<{ message: string; noCredit: boolean } | null>(null);

  /** Última conversa pedida: ignora respostas de cliques anteriores. */
  const requested = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const canSimulate = access === 'connected';

  function refreshList() {
    return listTestConversations(api, agent.id)
      .then((rows) => {
        setConversations(rows);
        setListError(null);
      })
      .catch((e: unknown) =>
        setListError(agentTestErrorMessage(e, 'Não foi possível carregar as conversas de teste.')),
      );
  }

  useEffect(() => {
    let cancelled = false;
    listTestConversations(api, agent.id)
      .then((rows) => !cancelled && setConversations(rows))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setListError(
            agentTestErrorMessage(e, 'Não foi possível carregar as conversas de teste.'),
          ),
      );
    return () => {
      cancelled = true;
    };
  }, [api, agent.id]);

  useEffect(() => {
    if (!featureOn) return;
    let cancelled = false;
    getCrmAccess(api, agent.id)
      .then((view) => !cancelled && setAccess(accessState(view)))
      // Sem o estado do acesso, segue sem simular cliente.
      .catch(() => !cancelled && setAccess('unavailable'));
    return () => {
      cancelled = true;
    };
  }, [api, agent.id, featureOn]);

  const openId = conversation?.id ?? null;
  const messageCount = conversation?.messages.length ?? 0;
  const waitingHere = sending !== null && sending.conversationId === openId;

  // Rolagem automática para o fim a cada mensagem nova e enquanto espera a resposta.
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messageCount, waitingHere, openId]);

  // Foco no campo ao abrir uma conversa e quando a resposta chega.
  useEffect(() => {
    if (openId && !waitingHere) input.current?.focus();
  }, [openId, waitingHere]);

  function openConversation(id: string) {
    requested.current = id;
    setSelectedId(id);
    setChoosingClient(false);
    setConversation(null);
    setConversationError(null);
    setSendError(null);
    setConfirmingDelete(null);
    setPane('chat');
    getTestConversation(api, agent.id, id)
      .then((view) => requested.current === id && setConversation(view))
      .catch(
        (e: unknown) =>
          requested.current === id &&
          setConversationError(agentTestErrorMessage(e, 'Não foi possível abrir a conversa.')),
      );
  }

  function startNew() {
    setCreateError(null);
    setConfirmingDelete(null);
    if (canSimulate) {
      requested.current = null;
      setSelectedId(null);
      setConversation(null);
      setConversationError(null);
      setChoosingClient(true);
      setPane('chat');
      return;
    }
    void create(null);
  }

  async function create(client: TestClient | null) {
    setCreating(true);
    setCreateError(null);
    try {
      const view = await createTestConversation(api, agent.id, { client });
      requested.current = view.id;
      setSelectedId(view.id);
      setConversation(view);
      setConversationError(null);
      setSendError(null);
      setChoosingClient(false);
      setText('');
      setPane('chat');
      void refreshList();
    } catch (e) {
      setCreateError(
        agentTestErrorMessage(e, 'Não foi possível começar a conversa. Tente de novo.'),
      );
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteTestConversation(api, agent.id, id);
      setConfirmingDelete(null);
      if (selectedId === id) {
        requested.current = null;
        setSelectedId(null);
        setConversation(null);
        setConversationError(null);
        setSendError(null);
        setPane('list');
      }
      setConversations((rows) => rows?.filter((row) => row.id !== id) ?? rows);
      void refreshList();
    } catch (e) {
      setDeleteError(agentTestErrorMessage(e, 'Não foi possível excluir a conversa.'));
    } finally {
      setDeleting(false);
    }
  }

  async function send(value: string) {
    const current = conversation;
    const message = value.trim();
    if (!current || sending || !message || message.length > AGENT_TEST_MESSAGE_MAX) return;
    const conversationId = current.id;
    setSending({ conversationId, text: message });
    setSendError(null);
    setText('');
    const merge = (extra: TestMessageView[]) =>
      setConversation((view) => {
        if (!view || view.id !== conversationId) return view;
        const known = new Set(extra.map((item) => item.id));
        return { ...view, messages: [...view.messages.filter((m) => !known.has(m.id)), ...extra] };
      });
    try {
      const exchange = await sendTestMessage(api, agent.id, conversationId, { text: message });
      merge(exchange.reply ? [exchange.message, exchange.reply] : [exchange.message]);
    } catch (e) {
      const failed = e instanceof ApiRequestError && e.code === 'TEST_REPLY_FAILED';
      // A pergunta recusada antes de chegar ao agente não fica salva: devolve o texto ao campo.
      if (!failed && requested.current === conversationId) {
        setText((typed) => (typed ? typed : message));
      }
      if (requested.current === conversationId) {
        // Com a falha do agente a pergunta fica salva como FAILED (com "Tentar de novo").
        setSendError(
          failed
            ? null
            : {
                message: agentTestErrorMessage(
                  e,
                  'Não foi possível enviar a mensagem. Tente de novo.',
                ),
                noCredit: noCredit(e),
              },
        );
      }
      getTestConversation(api, agent.id, conversationId)
        .then((view) => requested.current === conversationId && setConversation(view))
        .catch(() => undefined);
    } finally {
      setSending(null);
      void refreshList();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(text);
    }
  }

  const tooLong = text.length > AGENT_TEST_MESSAGE_MAX;
  const showChat = selectedId !== null || choosingClient;

  return (
    <Modal
      size="lg"
      title={`Testar agente — ${agent.name}`}
      onRequestClose={onClose}
      bodyClassName="flex overflow-hidden"
      header={
        <p className="mt-2 text-xs text-zinc-500">
          Cada resposta de teste consome créditos como uma conversa real. Gatilhos não são
          disparados e ações no CRM são apenas simuladas.
        </p>
      }
    >
      {/* Coluna da esquerda: conversas */}
      <aside
        className={`${pane === 'chat' ? 'hidden' : 'flex'} w-full min-w-0 flex-col border-zinc-200 md:flex md:w-72 md:shrink-0 md:border-r`}
        aria-label="Conversas de teste"
      >
        <div className="space-y-2 border-b border-zinc-200 p-3">
          <button
            type="button"
            onClick={startNew}
            disabled={creating || access === 'loading'}
            className={`${buttonClass('primary')} w-full`}
          >
            <PlusIcon className="size-4" />
            {creating && !choosingClient ? 'Criando…' : 'Nova conversa'}
          </button>
          {access === 'off' && (
            <p className="text-xs text-zinc-500">
              Para simular um cliente do CRM, ligue o &quot;Acesso ao CRM&quot; do agente.
            </p>
          )}
          {createError && !choosingClient && <Alert tone="error">{createError}</Alert>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {listError && (
            <Alert tone="error" className="m-3">
              {listError}
            </Alert>
          )}
          {deleteError && (
            <Alert tone="error" className="m-3">
              {deleteError}
            </Alert>
          )}
          {!conversations && !listError && (
            <div className="flex items-center gap-2 p-4 text-sm text-zinc-500" role="status">
              <Spinner className="size-4" />
              Carregando conversas…
            </div>
          )}
          {conversations?.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              <ChatIcon className="mx-auto mb-2 size-6 text-zinc-400" />
              Nenhuma conversa de teste ainda. Clique em &quot;Nova conversa&quot; e fale com o
              agente como se fosse um cliente.
            </div>
          )}
          {conversations && conversations.length > 0 && (
            <ul className="divide-y divide-zinc-100">
              {conversations.map((item) => {
                const selected = item.id === selectedId;
                return (
                  <li key={item.id} className={selected ? 'bg-brand-50' : 'hover:bg-zinc-50'}>
                    {confirmingDelete === item.id ? (
                      <div className="flex flex-wrap items-center gap-2 px-3 py-3">
                        <span className="flex-1 text-sm text-zinc-700">Excluir esta conversa?</span>
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(null)}
                          disabled={deleting}
                          className={buttonClass('secondary', 'sm')}
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(item.id)}
                          disabled={deleting}
                          className={buttonClass('danger', 'sm')}
                        >
                          {deleting ? 'Excluindo…' : 'Excluir'}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-start gap-1 pr-2">
                        <button
                          type="button"
                          onClick={() => openConversation(item.id)}
                          aria-current={selected ? 'true' : undefined}
                          className={`min-w-0 flex-1 border-l-2 py-3 pr-1 pl-3 text-left ${
                            selected ? 'border-brand-600' : 'border-transparent'
                          }`}
                        >
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm font-medium text-zinc-900">
                              {item.client ? item.client.name : 'Sem cliente do CRM'}
                            </span>
                            <span className="shrink-0 text-xs text-zinc-400">
                              {formatWhen(item.lastMessageAt)}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-zinc-500">
                            {item.lastMessage ?? 'Sem mensagens'}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-zinc-400">
                            {item.client ? `${TEST_CLIENT_TYPE_LABELS[item.client.type]} · ` : ''}
                            por {item.createdByName}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setConfirmingDelete(item.id);
                          }}
                          className="mt-2.5 rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                          aria-label="Excluir conversa"
                          title="Excluir conversa"
                        >
                          <TrashIcon className="size-4" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {conversations && conversations.length > 0 && (
            <p className="px-4 py-3 text-xs text-zinc-400">
              Guardamos as {AGENT_TEST_CONVERSATIONS_MAX} conversas mais recentes.
            </p>
          )}
        </div>
      </aside>

      {/* Coluna da direita: conversa selecionada ou escolha do cliente */}
      <section
        className={`${pane === 'list' ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col md:flex`}
        aria-label="Conversa de teste"
      >
        {!showChat && (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-sm text-zinc-500">
            <ChatIcon className="mb-2 size-8 text-zinc-300" />
            Selecione uma conversa ou comece uma nova.
          </div>
        )}

        {choosingClient && (
          <ClientStep
            creating={creating}
            error={createError}
            onBack={() => {
              setChoosingClient(false);
              setPane('list');
            }}
            onPick={(client) => create(client)}
          />
        )}

        {selectedId !== null && (
          <>
            <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setPane('list')}
                className="-ml-1 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 md:hidden"
                aria-label="Voltar para a lista de conversas"
              >
                <ArrowLeftIcon className="size-5" />
              </button>
              <p className="min-w-0 truncate text-sm text-zinc-700">
                {conversation ? (
                  conversation.client ? (
                    <>
                      <span className="text-zinc-500">Simulando:</span>{' '}
                      <span className="font-medium">{clientLabel(conversation.client)}</span>
                    </>
                  ) : (
                    <span className="text-zinc-500">Sem cliente do CRM</span>
                  )
                ) : (
                  <span className="text-zinc-400">Conversa de teste</span>
                )}
              </p>
            </div>

            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-zinc-50/60 px-4 py-4">
              {conversationError && <Alert tone="error">{conversationError}</Alert>}
              {!conversation && !conversationError && (
                <div className="flex items-center gap-2 text-sm text-zinc-500" role="status">
                  <Spinner className="size-4" />
                  Carregando conversa…
                </div>
              )}
              {conversation && (
                <ol className="space-y-3">
                  {conversation.messages.length === 0 && !waitingHere && (
                    <li className="py-8 text-center text-sm text-zinc-500">
                      Escreva uma mensagem como se você fosse o cliente.
                    </li>
                  )}
                  {conversation.messages.map((message) => (
                    <Bubble
                      key={message.id}
                      message={message}
                      retryDisabled={sending !== null}
                      onRetry={() => send(message.text)}
                    />
                  ))}
                  {waitingHere && (
                    <>
                      <li className="flex justify-end">
                        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand-600 px-3.5 py-2 text-sm whitespace-pre-wrap text-white opacity-80 [overflow-wrap:anywhere]">
                          {sending?.text}
                        </div>
                      </li>
                      <li className="flex justify-start">
                        <div
                          className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-white px-3.5 py-2 text-sm text-zinc-500 ring-1 ring-zinc-200"
                          aria-live="polite"
                          role="status"
                        >
                          <Spinner className="size-4" />
                          {agent.name} está digitando…
                        </div>
                      </li>
                    </>
                  )}
                </ol>
              )}
            </div>

            {conversation && (
              <form
                className="space-y-2 border-t border-zinc-200 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send(text);
                }}
              >
                {sendError && (
                  <Alert tone={sendError.noCredit ? 'warning' : 'error'}>
                    {sendError.noCredit ? (
                      <>
                        <p className="font-semibold">Sem créditos</p>
                        <p>{sendError.message}</p>
                      </>
                    ) : (
                      sendError.message
                    )}
                  </Alert>
                )}
                <div className="flex items-end gap-2">
                  <label htmlFor="test-chat-input" className="sr-only">
                    Mensagem para o agente
                  </label>
                  <textarea
                    id="test-chat-input"
                    ref={input}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={onKeyDown}
                    disabled={sending !== null}
                    rows={2}
                    placeholder="Escreva como se fosse o cliente… (Enter envia, Shift+Enter quebra linha)"
                    aria-describedby={text.length >= COUNTER_FROM ? 'test-chat-counter' : undefined}
                    className="max-h-40 min-h-[2.75rem] flex-1 resize-y rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500"
                  />
                  <button
                    type="submit"
                    disabled={sending !== null || !text.trim() || tooLong}
                    className={buttonClass('primary')}
                    aria-label="Enviar mensagem"
                  >
                    <SendIcon className="size-4" />
                    <span className="hidden sm:inline">Enviar</span>
                  </button>
                </div>
                {text.length >= COUNTER_FROM && (
                  <p
                    id="test-chat-counter"
                    className={`text-right text-xs ${tooLong ? 'text-red-600' : 'text-zinc-500'}`}
                  >
                    {text.length}/{AGENT_TEST_MESSAGE_MAX} caracteres
                  </p>
                )}
              </form>
            )}
          </>
        )}
      </section>
    </Modal>
  );
}

function Bubble({
  message,
  retryDisabled,
  onRetry,
}: {
  message: TestMessageView;
  retryDisabled: boolean;
  onRetry: () => void;
}) {
  const time = new Date(message.createdAt).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (message.role === 'AGENT') {
    return (
      <li className="flex flex-col items-start">
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-white px-3.5 py-2 text-sm whitespace-pre-wrap text-zinc-900 ring-1 ring-zinc-200 [overflow-wrap:anywhere]">
          {message.text}
        </div>
        <span className="mt-1 text-[11px] text-zinc-400">{time}</span>
      </li>
    );
  }
  return (
    <li className="flex flex-col items-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand-600 px-3.5 py-2 text-sm whitespace-pre-wrap text-white [overflow-wrap:anywhere]">
        {message.text}
      </div>
      {message.status === 'FAILED' ? (
        <span className="mt-1 flex items-center gap-2 text-xs text-red-700">
          O agente não respondeu
          <button
            type="button"
            onClick={onRetry}
            disabled={retryDisabled}
            className={buttonClass('secondary', 'sm')}
          >
            Tentar de novo
          </button>
        </span>
      ) : (
        <span className="mt-1 text-[11px] text-zinc-400">
          {message.status === 'PENDING' ? `${time} · aguardando resposta` : time}
        </span>
      )}
    </li>
  );
}

/** Passo opcional da nova conversa: escolher um cliente do CRM para o agente enxergar. */
function ClientStep({
  creating,
  error,
  onBack,
  onPick,
}: {
  creating: boolean;
  error: string | null;
  onBack: () => void;
  onPick: (client: TestClient | null) => void;
}) {
  const { api } = useAppSession();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{
    query: string;
    items: CrmClientOption[];
    error: string | null;
  } | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const term = query.trim();
  const ready = term.length >= CRM_CLIENT_SEARCH_MIN;
  const current = ready && results?.query === term ? results : null;
  const searching = ready && !current;

  useEffect(() => {
    field.current?.focus();
  }, []);

  useEffect(() => {
    if (term.length < CRM_CLIENT_SEARCH_MIN) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchCrmClients(api, term)
        .then((items) => !cancelled && setResults({ query: term, items, error: null }))
        .catch(
          (e: unknown) =>
            !cancelled &&
            setResults({
              query: term,
              items: [],
              error: agentTestErrorMessage(e, 'Não foi possível buscar clientes no CRM.'),
            }),
        );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, term]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 md:hidden"
          aria-label="Voltar para a lista de conversas"
        >
          <ArrowLeftIcon className="size-5" />
        </button>
        <h3 className="text-sm font-semibold text-zinc-900">Simular cliente do CRM</h3>
        <span className="text-xs text-zinc-400">(opcional)</span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <p className="text-sm text-zinc-600">
          Escolha um contato, lead ou empresa do Bitrix24 para o agente tratar como o cliente da
          conversa, ou comece sem cliente.
        </p>
        <div>
          <label
            htmlFor="test-chat-client"
            className="mb-1 block text-sm font-medium text-zinc-700"
          >
            Buscar cliente
          </label>
          <input
            id="test-chat-client"
            ref={field}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome, telefone ou e-mail"
            autoComplete="off"
            disabled={creating}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
          />
          {!ready && term.length > 0 && (
            <p className="mt-1 text-xs text-zinc-500">
              Digite pelo menos {CRM_CLIENT_SEARCH_MIN} caracteres.
            </p>
          )}
        </div>

        <div aria-live="polite">
          {searching && (
            <p className="flex items-center gap-2 text-sm text-zinc-500" role="status">
              <Spinner className="size-4" />
              Buscando…
            </p>
          )}
          {current?.error && <Alert tone="error">{current.error}</Alert>}
          {current && !current.error && current.items.length === 0 && (
            <p className="text-sm text-zinc-500">Nenhum cliente encontrado.</p>
          )}
          {current && current.items.length > 0 && (
            <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
              {current.items.map((option) => (
                <li key={`${option.type}-${option.id}`}>
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => onPick({ type: option.type, id: option.id, name: option.name })}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-900">
                        {option.name}
                      </span>
                      {option.company && (
                        <span className="block truncate text-xs text-zinc-500">
                          {option.company}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                      {TEST_CLIENT_TYPE_LABELS[option.type]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-zinc-200 p-3">
        {creating && <Spinner className="size-4" />}
        <button
          type="button"
          onClick={() => onPick(null)}
          disabled={creating}
          className={buttonClass('secondary')}
        >
          Começar sem cliente
        </button>
      </div>
    </div>
  );
}
