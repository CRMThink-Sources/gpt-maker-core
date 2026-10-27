#!/usr/bin/env node
// Validador de funções do GPTThink, sem dependências (Node 18+).
// Uso: node scripts/validar.mjs <funcao.json> [blocos.json]
// Reproduz a checagem de publicação do backoffice: estrutura, marcadores, dependentes,
// condições, orçamento de 3000 caracteres no pior caso e tamanho dos itens da base.
// A palavra final é do backoffice (aba Testar / Publicar), mas o que passa aqui costuma publicar.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BEHAVIOR_MAX = 3000;
const ADDITIONAL_MAX = 400;
const AGENT_NAME_MAX = 100;
const TRAINING_MAX = 1028;
const BUILTINS = ['agente.nome', 'avancado.instrucoes_adicionais'];
const COLLECTED = 'intencao.respostas';
const RUNTIME_ROOTS = ['contact', 'message', 'agent', 'event', 'dialog', 'interaction', 'payload', 'fields'];
const TEMPLATE_VARIABLES = [
  'contact.name', 'contact.phone', 'message.text', 'message.role', 'agent.name', 'agent.id',
  'event.name', 'event.date', 'dialog.id', 'interaction.id', 'interaction.protocol',
];
const FIELD_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const SIMPLE_ID = /^[a-z][a-z0-9_]*$/;
const MARKER = /\{\{\s*([^{}|\s]+)\s*\}\}/g;
const KINDS = ['TEXT', 'TEXT_LIST', 'URL', 'INTEGER', 'BITRIX_USER', 'BITRIX_STAGE', 'BITRIX_OPENLINE', 'AGENT', 'CHOICE', 'MULTI_CHOICE', 'KNOWLEDGE'];
const ACTIONS = ['CREATE_LEAD', 'UPSERT_DEAL', 'TIMELINE_COMMENT', 'CREATE_TASK', 'START_BIZPROC', 'TRANSFER_TO_HUMAN'];
const FIELD_TYPES = ['STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'DATE_TIME', 'URL'];

const here = path.dirname(fileURLToPath(import.meta.url));
const [file, blocksFile = path.join(here, '..', 'referencia', 'blocos.json')] = process.argv.slice(2);
if (!file) {
  console.error('uso: node scripts/validar.mjs <funcao.json> [blocos.json]');
  process.exit(2);
}

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);

const input = JSON.parse(fs.readFileSync(file, 'utf8'));
const blocks = new Map(JSON.parse(fs.readFileSync(blocksFile, 'utf8')).map((b) => [b.code, b.draft]));
const draft = input.draft ?? input;

const markers = (text) => [...new Set([...String(text ?? '').matchAll(MARKER)].map((m) => m[1]))];
const isRuntime = (p) => RUNTIME_ROOTS.includes(p.split('.')[0]);
const jsonName = (name) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const int = (v) => Number.isInteger(v);

// ---------- metadados ----------
if (input.draft) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(input.code ?? '')) err('code: use maiúsculas e _ (ex.: "COBRANCA")');
  if (!str(input.name, 1, 100)) err('name: 1 a 100 caracteres');
  if (!str(input.description, 1, 500)) err('description: 1 a 500 caracteres');
}

// ---------- estrutura ----------
function checkField(f, where) {
  const at = `${where} ${f?.id ?? '?'}`;
  if (!KINDS.includes(f?.kind)) return err(`${at}: kind inválido (${f?.kind})`);
  if (!FIELD_ID.test(f.id ?? '') || isRuntime(f.id ?? '')) err(`${at}: id precisa ser minúsculas com ponto, ex.: "sdr.perfil_ideal"`);
  if (!str(f.label, 1, 120)) err(`${at}: label de 1 a 120 caracteres`);
  if (f.help !== undefined && !str(f.help, 0, 300)) err(`${at}: help até 300 caracteres`);
  if (typeof f.required !== 'boolean') err(`${at}: required precisa ser true/false`);
  switch (f.kind) {
    case 'TEXT':
      if (!int(f.maxLength) || f.maxLength < 1 || f.maxLength > BEHAVIOR_MAX) err(`${at}: maxLength de 1 a 3000`);
      break;
    case 'TEXT_LIST':
      if (!int(f.minItems) || !int(f.maxItems) || f.minItems < 0 || f.maxItems < 1 || f.maxItems > 20 || f.minItems > f.maxItems)
        err(`${at}: minItems 0..20, maxItems 1..20, min ≤ max`);
      if (!int(f.itemMaxLength) || f.itemMaxLength < 1 || f.itemMaxLength > 1000) err(`${at}: itemMaxLength de 1 a 1000`);
      break;
    case 'URL':
      if (f.maxLength !== undefined && (!int(f.maxLength) || f.maxLength < 10 || f.maxLength > 2000)) err(`${at}: maxLength de 10 a 2000`);
      break;
    case 'BITRIX_USER':
      if (f.multiple !== undefined && typeof f.multiple !== 'boolean') err(`${at}: multiple precisa ser true/false`);
      break;
    case 'INTEGER':
      if (!int(f.min) || !int(f.max) || f.min > f.max) err(`${at}: min e max inteiros, min ≤ max`);
      break;
    case 'CHOICE':
    case 'MULTI_CHOICE': {
      const opts = f.options;
      if (!Array.isArray(opts) || opts.length < 1 || opts.length > 10) { err(`${at}: 1 a 10 opções`); break; }
      if (new Set(opts.map((o) => o.value)).size !== opts.length) err(`${at}: há opções com o mesmo value`);
      for (const o of opts) {
        if (!SIMPLE_ID.test(o.value ?? '')) err(`${at}: value "${o.value}" — use minúsculas, números e _`);
        if (!str(o.label, 1, 120)) err(`${at}=${o.value}: label de 1 a 120`);
        if (!str(o.snippet, 1, BEHAVIOR_MAX)) err(`${at}=${o.value}: escreva o snippet (trecho) da opção`);
        if (o.dependents !== undefined) {
          if (!Array.isArray(o.dependents) || o.dependents.length > 10) err(`${at}=${o.value}: até 10 dependentes`);
          else o.dependents.forEach((d) => checkField(d, `dependente de ${f.id}=${o.value}:`));
        }
        const fx = o.effects;
        if (fx?.communicationType && !['FORMAL', 'NORMAL', 'RELAXED'].includes(fx.communicationType))
          err(`${at}=${o.value}: communicationType FORMAL, NORMAL ou RELAXED`);
      }
      if (f.kind === 'MULTI_CHOICE' && f.separator !== undefined && (typeof f.separator !== 'string' || f.separator.length > 10))
        err(`${at}: separator até 10 caracteres`);
      break;
    }
    case 'KNOWLEDGE':
      if (!int(f.maxItems) || f.maxItems < 1 || f.maxItems > 50) err(`${at}: maxItems de 1 a 50`);
      if (!Array.isArray(f.subfields) || f.subfields.length < 1 || f.subfields.length > 6) { err(`${at}: 1 a 6 subfields`); break; }
      for (const s of f.subfields) {
        if (!SIMPLE_ID.test(s.id ?? '')) err(`${at}: subcampo "${s.id}" — minúsculas, números e _`);
        if (!int(s.maxLength) || s.maxLength < 1 || s.maxLength > TRAINING_MAX) err(`${at}.${s.id}: maxLength de 1 a ${TRAINING_MAX}`);
      }
      if (!str(f.format, 1, 500)) err(`${at}: format de 1 a 500 caracteres`);
      break;
  }
}

if (!['SUPPORT', 'SALE', 'PERSONAL'].includes(draft.agentType)) err('agentType: SUPPORT, SALE ou PERSONAL');
if (!Array.isArray(draft.fields) || draft.fields.length < 1) err('fields: pelo menos um campo próprio');
if (!str(draft.behavior, 1, BEHAVIOR_MAX)) err('behavior: 1 a 3000 caracteres (texto cru)');
if ((draft.intentions ?? []).length > 10) err('intentions: no máximo 10');
if ((draft.transfers ?? []).length > 5) err('transfers: no máximo 5');
for (const t of draft.transfers ?? []) {
  const at = `transferência ${t?.key ?? '?'}`;
  if (!SIMPLE_ID.test(t?.key ?? '')) err(`${at}: key em minúsculas, números e _`);
  if (!str(t?.agent, 1, 200)) err(`${at}: agent precisa ser o marcador de um campo AGENT, ex.: "{{suporte.agente}}"`);
  if (!str(t?.instructions, 1, 1000)) err(`${at}: instructions de 1 a 1000 caracteres`);
  if (t?.returnOnFinish !== undefined && typeof t.returnOnFinish !== 'boolean') err(`${at}: returnOnFinish true/false`);
}
if ((draft.blocks ?? []).length > 10) err('blocks: no máximo 10');
for (const p of ['jobName', 'jobSite']) if ((draft.profile?.[p] ?? '').length > 200) err(`profile.${p}: até 200`);
if ((draft.profile?.jobDescription ?? '').length > 500) err('profile.jobDescription: até 500');
(draft.fields ?? []).forEach((f) => checkField(f, 'campo'));

// ---------- expansão dos blocos ----------
const included = [];
for (const code of draft.blocks ?? []) {
  const b = blocks.get(code);
  if (b) included.push(b);
  else err(`bloco inexistente: ${code} (disponíveis: ${[...blocks.keys()].join(', ')})`);
}
const replaceBlocks = (text) =>
  String(text ?? '').replace(/\{\{\s*bloco\.([a-z][a-z0-9_]*)\s*\}\}/g, (m, code) => {
    if (!(draft.blocks ?? []).includes(code) || !blocks.has(code)) {
      err(`{{bloco.${code}}} citado, mas o bloco não está em "blocks"`);
      return m;
    }
    return blocks.get(code).behavior ?? '';
  });
for (const code of draft.blocks ?? []) {
  const b = blocks.get(code);
  if (b?.behavior && !markers(draft.behavior).includes(`bloco.${code}`))
    warnings.push(`o bloco "${code}" tem texto, mas {{bloco.${code}}} não aparece no behavior`);
}
const content = {
  ...draft,
  behavior: replaceBlocks(draft.behavior),
  profile: { jobName: '', jobDescription: '', jobSite: '', ...(draft.profile ?? {}) },
  fields: [...included.flatMap((b) => b.fields ?? []), ...(draft.fields ?? [])],
  intentions: [...(draft.intentions ?? []), ...included.flatMap((b) => b.intentions ?? [])].map((i) => ({
    ...i,
    whenToUse: replaceBlocks(i.whenToUse),
    instructions: i.instructions ? replaceBlocks(i.instructions) : null,
  })),
  transfers: [...(draft.transfers ?? []), ...included.flatMap((b) => b.transfers ?? [])],
};
if (content.fields.length > 40) err(`formulário com ${content.fields.length} campos de topo (máximo 40, com os dos blocos)`);

const flatten = (fields) =>
  fields.flatMap((f) => [f, ...(f.options ?? []).flatMap((o) => flatten(o.dependents ?? []))]);
const all = flatten(content.fields);
const byId = new Map();
for (const f of all) {
  if (byId.has(f.id)) err(`campo repetido: ${f.id}`);
  byId.set(f.id, f);
}

// ---------- marcadores ----------
const known = new Set([...byId.keys(), ...BUILTINS]);
for (const f of all) if (f.kind === 'BITRIX_STAGE') { known.add(`${f.id}.categoryId`); known.add(`${f.id}.stageId`); }
const check = (text, label, extra = []) => {
  for (const m of markers(text)) {
    if (isRuntime(m) || known.has(m) || extra.includes(m)) continue;
    err(`marcador sem campo em ${label}: {{${m}}}`);
  }
};
check(content.behavior, 'behavior');
for (const p of ['jobName', 'jobDescription', 'jobSite']) check(content.profile[p], `profile.${p}`);
for (const f of all) {
  for (const o of f.options ?? []) check(o.snippet, `opção ${f.id}=${o.value}`);
  if (f.kind === 'KNOWLEDGE') {
    const ids = f.subfields.map((s) => s.id);
    for (const m of markers(f.format)) if (!ids.includes(m)) err(`subcampo inexistente no format de ${f.id}: {{${m}}}`);
    // Pior caso do item: format com todos os subcampos no limite.
    const len = f.format.replace(MARKER, (_m, id) => 'x'.repeat(f.subfields.find((s) => s.id === id)?.maxLength ?? 0)).trim().length;
    if (len > TRAINING_MAX) err(`item da base ${f.id} pode ter ${len} caracteres (limite ${TRAINING_MAX}): reduza os maxLength`);
  }
}
if (markers(draft.behavior).some((m) => byId.get(m)?.kind === 'KNOWLEDGE'))
  err('campo KNOWLEDGE citado no behavior: a base vira treinamento, não texto');
if (!markers(draft.behavior).includes('avancado.instrucoes_adicionais'))
  warnings.push('o behavior não termina com {{avancado.instrucoes_adicionais}}');

// ---------- dependentes sem uso ----------
const configTexts = (v) =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(configTexts) : v && typeof v === 'object' ? Object.values(v).flatMap(configTexts) : [];
const intentionTexts = (i) => [
  i.name, i.whenToUse, i.instructions ?? '',
  ...(i.fields ?? []).map((f) => f.description ?? ''),
  ...(i.actions ?? []).flatMap((a) => configTexts(a.config)),
];
const used = new Set([
  ...markers(content.behavior),
  ...all.flatMap((f) => (f.options ?? []).flatMap((o) => markers(o.snippet))),
  ...content.intentions.flatMap((i) => [
    ...intentionTexts(i).flatMap(markers),
    ...[i.when, ...(i.actions ?? []).map((a) => a.when)].filter(Boolean).map((c) => c.field),
  ]),
  ...content.transfers.flatMap((t) => [
    ...markers(t.agent),
    ...markers(t.instructions),
    ...(t.when ? [t.when.field] : []),
  ]),
]);
const parents = new Map();
for (const f of all)
  for (const o of f.options ?? [])
    for (const d of o.dependents ?? []) {
      const e = parents.get(d.id) ?? { field: f, options: [] };
      e.options.push(o.value);
      parents.set(d.id, e);
      if (![...used].some((m) => m === d.id || m.startsWith(`${d.id}.`))) err(`campo dependente sem uso: ${d.id}`);
    }
for (const f of all) {
  if (f.kind === 'KNOWLEDGE' || parents.has(f.id)) continue;
  if (![...used].some((m) => m === f.id || m.startsWith(`${f.id}.`)))
    warnings.push(`campo ${f.id} não é citado em lugar nenhum (behavior, trechos, ações ou condições)`);
}

// ---------- intenções ----------
const NUMERIC = { UPSERT_DEAL: ['categoryId'], CREATE_TASK: ['responsibleId', 'deadlineDays'], START_BIZPROC: ['templateId'], TRANSFER_TO_HUMAN: ['userId', 'lineId'] };
const numericMarker = (m) => {
  const f = byId.get(m);
  if (f && ['INTEGER', 'BITRIX_USER', 'BITRIX_OPENLINE'].includes(f.kind)) return true;
  return m.endsWith('.categoryId') && byId.get(m.slice(0, -'.categoryId'.length))?.kind === 'BITRIX_STAGE';
};
const keys = new Set();
for (const i of content.intentions) {
  const at = `intenção ${i.key ?? '?'}`;
  if (!SIMPLE_ID.test(i.key ?? '')) err(`${at}: key em minúsculas, números e _`);
  if (keys.has(i.key)) err(`intenção repetida: ${i.key}`);
  keys.add(i.key);
  if (!str(i.name, 1, 255)) err(`${at}: name de 1 a 255`);
  if (!str(i.whenToUse, 1, 512)) err(`${at}: whenToUse de 1 a 512`);
  if ((i.instructions ?? '').length > 5000) err(`${at}: instructions até 5000`);
  if ((i.responseMode ?? 'INSTRUCTIONS') === 'INSTRUCTIONS' && !String(i.instructions ?? '').trim())
    err(`${at}: escreva instructions (o que o agente diz depois da ação)`);
  const ifields = i.fields ?? [];
  if (ifields.length > 20) err(`${at}: até 20 fields`);
  for (const f of ifields) {
    if (!str(f.name, 1, 60)) err(`${at}: nome de campo de 1 a 60`);
    if (!FIELD_TYPES.includes(f.type)) err(`${at}.${f.name}: type ${FIELD_TYPES.join(', ')}`);
    if (typeof f.required !== 'boolean') err(`${at}.${f.name}: required true/false`);
  }
  if (i.collectFrom && byId.get(i.collectFrom)?.kind !== 'TEXT_LIST') err(`${at}: collectFrom precisa citar um TEXT_LIST`);
  const extra = i.collectFrom ? [COLLECTED] : [];
  for (const t of [i.name, i.whenToUse, i.instructions ?? '', ...ifields.map((f) => f.description ?? '')]) check(t, at, extra);
  const declared = new Set(ifields.map((f) => jsonName(f.name)));
  if (!Array.isArray(i.actions) || i.actions.length < 1 || i.actions.length > 10) err(`${at}: 1 a 10 ações`);
  for (const [idx, a] of (i.actions ?? []).entries()) {
    const aat = `${at}, ação ${idx + 1} (${a.type})`;
    if (!ACTIONS.includes(a.type)) { err(`${aat}: type inválido; use ${ACTIONS.join(', ')}`); continue; }
    const c = a.config ?? {};
    for (const t of configTexts(c)) {
      check(t, aat, extra);
      for (const m of markers(t)) {
        if (!isRuntime(m)) continue;
        if (m.startsWith('fields.')) {
          const name = m.slice(7);
          if (!declared.has(name) && !(i.collectFrom && /^pergunta_\d+$/.test(name)))
            err(`${aat}: {{${m}}} não é um campo coletado (declarados: ${[...declared].map((n) => 'fields.' + n).join(', ') || 'nenhum'})`);
        } else if (!TEMPLATE_VARIABLES.includes(m) && !m.startsWith('payload.')) err(`${aat}: variável desconhecida {{${m}}}`);
      }
    }
    for (const k of NUMERIC[a.type] ?? []) {
      const v = c[k];
      if (v === undefined || typeof v === 'number') continue;
      const ms = markers(v);
      if (!(typeof v === 'string' && ms.length === 1 && v.trim() === `{{${ms[0]}}}` && numericMarker(ms[0])))
        err(`${aat}: ${k} precisa ser número ou um marcador sozinho de INTEGER/BITRIX_USER/funil (ex.: "{{x.funil.categoryId}}")`);
    }
    if (a.type === 'CREATE_LEAD' && !c.fields?.TITLE) err(`${aat}: config.fields.TITLE é obrigatório`);
    if (a.type === 'UPSERT_DEAL' && (c.categoryId === undefined || !c.stageId || !c.fields)) err(`${aat}: config precisa de categoryId, stageId e fields`);
    if (a.type === 'TIMELINE_COMMENT' && !c.text) err(`${aat}: config.text é obrigatório`);
    if (a.type === 'CREATE_TASK' && (!c.title || c.responsibleId === undefined)) err(`${aat}: config precisa de title e responsibleId`);
    if (a.type === 'START_BIZPROC' && (c.templateId === undefined || !['LEAD', 'DEAL', 'CONTACT', 'COMPANY'].includes(c.documentType)))
      err(`${aat}: config precisa de templateId e documentType (LEAD, DEAL, CONTACT, COMPANY)`);
    if (a.type === 'TRANSFER_TO_HUMAN' && c.target === 'LINE' && c.lineId === undefined)
      err(`${aat}: target LINE precisa de lineId (campo BITRIX_OPENLINE)`);
    if (a.type === 'TRANSFER_TO_HUMAN' && (!['OPERATOR', 'USER', 'LINE'].includes(c.target) || (c.target === 'USER' && c.userId === undefined)))
      err(`${aat}: target OPERATOR, ou USER com userId`);
    // Passo que usa um dependente precisa de condição que garanta a opção dele.
    const cited = new Set(configTexts(c).flatMap(markers).map((m) => m.replace(/\.(categoryId|stageId)$/, '')));
    for (const id of cited) {
      const p = parents.get(id);
      if (!p) continue;
      const ok = (cond) => cond?.field === p.field.id && cond.in.every((v) => p.options.includes(v));
      if (!ok(i.when) && !ok(a.when))
        err(`${aat}: usa ${id}, que só existe com ${p.field.id} em [${p.options.join(', ')}]; ponha esse "when" na ação ou na intenção`);
    }
  }
  for (const cond of [i.when, ...(i.actions ?? []).map((a) => a.when)].filter(Boolean)) {
    const f = byId.get(cond.field);
    if (!f || !['CHOICE', 'MULTI_CHOICE'].includes(f.kind)) { err(`${at}: condição cita campo que não é escolha: ${cond.field}`); continue; }
    for (const v of cond.in ?? []) if (!f.options.some((o) => o.value === v)) err(`${at}: condição cita opção inexistente: ${cond.field}=${v}`);
  }
}

// ---------- transferências entre agentes ----------
const transferKeys = new Set();
for (const t of content.transfers) {
  const label = `transferência ${t.key}`;
  if (transferKeys.has(t.key)) err(`transferência repetida: ${t.key}`);
  transferKeys.add(t.key);
  const agentField = /^\{\{\s*([^{}|\s]+)\s*\}\}$/.exec(String(t.agent ?? '').trim())?.[1];
  if (!agentField || byId.get(agentField)?.kind !== 'AGENT') err(`${label}: escolha um campo de agente`);
  check(t.instructions, label);
  if (t.when) {
    const f = byId.get(t.when.field);
    if (!f || !['CHOICE', 'MULTI_CHOICE'].includes(f.kind)) err(`condição da ${label} cita campo que não é escolha: ${t.when.field}`);
    else for (const v of t.when.in ?? []) if (!f.options.some((o) => o.value === v)) err(`condição da ${label} cita opção inexistente: ${t.when.field}=${v}`);
  }
  for (const id of new Set([...markers(t.agent), ...markers(t.instructions)])) {
    const p = parents.get(id);
    if (!p) continue;
    const ok = t.when?.field === p.field.id && t.when.in.every((v) => p.options.includes(v));
    if (!ok) err(`Transferência ${t.key} usa "${byId.get(id).label}", que só existe com ${p.field.id} em [${p.options.join(', ')}]: ponha essa condição na transferência`);
  }
}

// ---------- orçamento no pior caso ----------
function render(text, answers, builtins, depth = 0) {
  return String(text).replace(MARKER, (match, p) => (isRuntime(p) ? match : value(p, answers, builtins, depth)));
}
function value(p, answers, builtins, depth = 0) {
  if (p in builtins) return builtins[p];
  const f = byId.get(p);
  if (!f) {
    const id = p.slice(0, p.lastIndexOf('.'));
    const part = p.slice(p.lastIndexOf('.') + 1);
    if (byId.get(id)?.kind === 'BITRIX_STAGE') return part === 'categoryId' ? '9999' : part === 'stageId' ? 'C9999:XXXXXXXXXXXX' : '';
    return '';
  }
  const v = answers[f.id];
  if (v === undefined) return '';
  switch (f.kind) {
    case 'TEXT': case 'URL': case 'INTEGER': case 'BITRIX_OPENLINE': return String(v);
    case 'BITRIX_USER': return Array.isArray(v) ? v.join(', ') : String(v);
    case 'BITRIX_STAGE': return '9999:C9999:XXXXXXXXXXXX';
    case 'TEXT_LIST': return v.map((x) => `- ${x}`).join('\n');
    case 'CHOICE': case 'MULTI_CHOICE': {
      if (depth >= 5) return '';
      const chosen = Array.isArray(v) ? v : [v];
      return f.options.filter((o) => chosen.includes(o.value)).map((o) => render(o.snippet, answers, builtins, depth + 1))
        .join(f.kind === 'MULTI_CHOICE' ? (f.separator ?? '\n\n') : '');
    }
    default: return '';
  }
}
const normalize = (t) => t.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
// Roda mesmo com outros erros (como o backoffice), salvo estrutura quebrada demais para medir.
try {
  const answers = {};
  for (const f of all) {
    if (f.kind === 'TEXT' || f.kind === 'URL') answers[f.id] = 'x'.repeat(f.maxLength ?? 200);
    if (f.kind === 'TEXT_LIST') answers[f.id] = Array.from({ length: f.maxItems }, () => 'x'.repeat(f.itemMaxLength));
    if (f.kind === 'INTEGER') answers[f.id] = String(f.min).length > String(f.max).length ? f.min : f.max;
    if (f.kind === 'BITRIX_USER') answers[f.id] = f.multiple ? Array.from({ length: 20 }, () => 9999999) : 9999999;
    if (f.kind === 'BITRIX_OPENLINE') answers[f.id] = 9999999;
    if (f.kind === 'BITRIX_STAGE') answers[f.id] = {};
    if (f.kind === 'MULTI_CHOICE') answers[f.id] = f.options.map((o) => o.value);
  }
  const builtins = { 'agente.nome': 'x'.repeat(AGENT_NAME_MAX), 'avancado.instrucoes_adicionais': 'x'.repeat(ADDITIONAL_MAX) };
  for (const f of all) {
    if (f.kind !== 'CHOICE') continue;
    let best = { v: f.options[0].value, len: -1 };
    for (const o of f.options) {
      const len = value(f.id, { ...answers, [f.id]: o.value }, builtins).length;
      if (len > best.len) best = { v: o.value, len };
    }
    answers[f.id] = best.v;
  }
  const parts = {};
  for (const [, p] of content.behavior.matchAll(MARKER)) parts[p] = (parts[p] ?? 0) + value(p, answers, builtins).length;
  const fixed = content.behavior.replace(MARKER, '').length;
  const length = normalize(render(content.behavior, answers, builtins)).length;
  const top = Object.entries(parts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}: ${n}`).join(', ');
  const line = `pior caso do comportamento: ${length}/${BEHAVIOR_MAX} (texto fixo ${fixed}; ${top})`;
  if (length > BEHAVIOR_MAX) err(line);
  else {
    console.log(line);
    if (length > 2950) warnings.push('pior caso acima de 2950: pouca folga, revise os limites');
  }
} catch {
  warnings.push('não deu para medir o pior caso: corrija a estrutura primeiro');
}

// Ação citada no texto ("use a ação \"X\"") precisa existir como intenção (ou ser a do CRM).
{
  const names = new Set([...content.intentions.map((i) => i.name), ...(content.crmAccess || included.some((b) => b.crmAccess) ? ["Consultar cliente no CRM"] : [])]);
  const texts = [content.behavior, ...all.flatMap((f) => (f.options ?? []).map((o) => o.snippet)), ...content.intentions.map((i) => i.instructions ?? "")];
  for (const t of texts)
    for (const [, n] of String(t).matchAll(/(?:ação|[Uu]se|[Uu]sar)\s+(?:a ação\s+)?"([^"]+)"/g))
      if (!names.has(n)) warnings.push(`o texto cita a ação "${n}", mas não há intenção com esse name (existentes: ${[...names].join(", ")})`);
}

for (const w of warnings) console.log(`aviso: ${w}`);
if (errors.length) {
  for (const e of errors) console.log(`ERRO: ${e}`);
  console.log(`\n${errors.length} erro(s): o backoffice não publica assim.`);
  process.exit(1);
}
console.log('OK: estrutura, marcadores, ações e orçamento válidos.');
