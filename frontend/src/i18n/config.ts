import { DEFAULT_LOCALE, isLocale, type Locale } from '@gptmaker/contracts';
import ptBR_common from './messages/pt-BR/common.json';
import ptBR_errors from './messages/pt-BR/errors.json';
import ptBR_shell from './messages/pt-BR/shell.json';
import ptBR_session from './messages/pt-BR/session.json';
import ptBR_agentForm from './messages/pt-BR/agentForm.json';
import ptBR_agentDetail from './messages/pt-BR/agentDetail.json';
import ptBR_agentFunction from './messages/pt-BR/agentFunction.json';
import ptBR_intentions from './messages/pt-BR/intentions.json';
import ptBR_trainings from './messages/pt-BR/trainings.json';
import ptBR_triggers from './messages/pt-BR/triggers.json';
import ptBR_crm from './messages/pt-BR/crm.json';
import ptBR_calendar from './messages/pt-BR/calendar.json';
import ptBR_testChat from './messages/pt-BR/testChat.json';
import ptBR_assist from './messages/pt-BR/assist.json';
import ptBR_plan from './messages/pt-BR/plan.json';
import ptBR_aiKey from './messages/pt-BR/aiKey.json';
import ptBR_permissions from './messages/pt-BR/permissions.json';
import ptBR_notifications from './messages/pt-BR/notifications.json';
import ptBR_home from './messages/pt-BR/home.json';
import en_common from './messages/en/common.json';
import en_errors from './messages/en/errors.json';
import en_shell from './messages/en/shell.json';
import en_session from './messages/en/session.json';
import en_agentForm from './messages/en/agentForm.json';
import en_agentDetail from './messages/en/agentDetail.json';
import en_agentFunction from './messages/en/agentFunction.json';
import en_intentions from './messages/en/intentions.json';
import en_trainings from './messages/en/trainings.json';
import en_triggers from './messages/en/triggers.json';
import en_crm from './messages/en/crm.json';
import en_calendar from './messages/en/calendar.json';
import en_testChat from './messages/en/testChat.json';
import en_assist from './messages/en/assist.json';
import en_plan from './messages/en/plan.json';
import en_aiKey from './messages/en/aiKey.json';
import en_permissions from './messages/en/permissions.json';
import en_notifications from './messages/en/notifications.json';
import en_home from './messages/en/home.json';
import es_common from './messages/es/common.json';
import es_errors from './messages/es/errors.json';
import es_shell from './messages/es/shell.json';
import es_session from './messages/es/session.json';
import es_agentForm from './messages/es/agentForm.json';
import es_agentDetail from './messages/es/agentDetail.json';
import es_agentFunction from './messages/es/agentFunction.json';
import es_intentions from './messages/es/intentions.json';
import es_trainings from './messages/es/trainings.json';
import es_triggers from './messages/es/triggers.json';
import es_crm from './messages/es/crm.json';
import es_calendar from './messages/es/calendar.json';
import es_testChat from './messages/es/testChat.json';
import es_assist from './messages/es/assist.json';
import es_plan from './messages/es/plan.json';
import es_aiKey from './messages/es/aiKey.json';
import es_permissions from './messages/es/permissions.json';
import es_notifications from './messages/es/notifications.json';
import es_home from './messages/es/home.json';

// Um arquivo JSON por namespace e idioma (cada área da UI é dona do seu).
const ptBR = {
  common: ptBR_common,
  errors: ptBR_errors,
  shell: ptBR_shell,
  session: ptBR_session,
  agentForm: ptBR_agentForm,
  agentDetail: ptBR_agentDetail,
  agentFunction: ptBR_agentFunction,
  intentions: ptBR_intentions,
  trainings: ptBR_trainings,
  triggers: ptBR_triggers,
  crm: ptBR_crm,
  calendar: ptBR_calendar,
  testChat: ptBR_testChat,
  assist: ptBR_assist,
  plan: ptBR_plan,
  aiKey: ptBR_aiKey,
  permissions: ptBR_permissions,
  notifications: ptBR_notifications,
  home: ptBR_home,
};

const en = {
  common: en_common,
  errors: en_errors,
  shell: en_shell,
  session: en_session,
  agentForm: en_agentForm,
  agentDetail: en_agentDetail,
  agentFunction: en_agentFunction,
  intentions: en_intentions,
  trainings: en_trainings,
  triggers: en_triggers,
  crm: en_crm,
  calendar: en_calendar,
  testChat: en_testChat,
  assist: en_assist,
  plan: en_plan,
  aiKey: en_aiKey,
  permissions: en_permissions,
  notifications: en_notifications,
  home: en_home,
};

const es = {
  common: es_common,
  errors: es_errors,
  shell: es_shell,
  session: es_session,
  agentForm: es_agentForm,
  agentDetail: es_agentDetail,
  agentFunction: es_agentFunction,
  intentions: es_intentions,
  trainings: es_trainings,
  triggers: es_triggers,
  crm: es_crm,
  calendar: es_calendar,
  testChat: es_testChat,
  assist: es_assist,
  plan: es_plan,
  aiKey: es_aiKey,
  permissions: es_permissions,
  notifications: es_notifications,
  home: es_home,
};

export type Messages = typeof ptBR;

/** `pt-BR` é a fonte; o teste de paridade garante que `en` e `es` têm as mesmas chaves. */
export const MESSAGES: Record<Locale, Messages> = { 'pt-BR': ptBR, en, es };

export const LOCALE_STORAGE_KEY = 'gptthink.locale';

/** Nome de cada idioma no próprio idioma (seletor). */
export const LOCALE_LABELS: Record<Locale, string> = {
  'pt-BR': 'Português',
  en: 'English',
  es: 'Español',
};

export { DEFAULT_LOCALE };

/** Preferência salva pelo usuário; `null` sem armazenamento ou valor inválido. */
export function readStoredLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Sem armazenamento (iframe com cookies bloqueados): vale só nesta sessão.
  }
}
