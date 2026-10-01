# Bitrix24: comportamento observado

O que a documentação oficial do Bitrix24 não descreve (ou descreve de forma incompleta) e foi
confirmado num portal real. Cada item diz onde o app depende dele.

## Eventos do chatbot (`imbot.v2`, webhook)

- **Autenticação:** comparar o `auth[application_token]` do nível de cima do evento com o token da
  instalação (o mesmo do `ONAPPINSTALL`). O `data.bot.auth.application_token` traz o mesmo valor.
  Sem o `ONAPPINSTALL` registrado, a plataforma fica sem token e todo evento é recusado
  (`token_mismatch` com `expected: null`). Observado em 2026-10-01.
- **Anexo do cliente** (`ONIMBOTV2MESSAGEADD`): vem em `data.message.params.FILE_ID`, lista de ids
  do Disco em texto (`{ "FILE_ID": ["247650"] }`), com `text` vazio quando só há o arquivo. O
  `imbot.v2.File.download` com esse id devolve o link de download. Usado em
  `channel/message-attachments.ts` e `chat-media.ts`. Observado em 2026-10-01.
- **Sessão nova da Linha Aberta:** o `ONIMBOTV2JOINCHAT` chega junto com a primeira mensagem do
  cliente. O app usa esse evento como fim do atendimento humano (9.8). A chegada a cada sessão nova
  depois de um atendimento humano ainda precisa ser confirmada.

## Vínculo do diálogo com o CRM (`imopenlines.dialog.get`)

Chamado com `DIALOG_ID` (`chat9498`). Resposta real (2026-10-01), só os campos de vínculo:

```json
{
  "id": 9498,
  "type": "lines",
  "entity_type": "LINES",
  "entity_id": "hubthink_thinkzap_homolog|136|271902299951214@lid|2002",
  "entity_data_1": "Y|DEAL|27134|N|N|1932|1790875607|0|0|0",
  "entity_data_2": "LEAD|0|COMPANY|39964|CONTACT|9448|DEAL|27134",
  "entity_data_3": "N",
  "dialog_id": "chat9498"
}
```

- `entity_data_2`: pares tipo e id (`LEAD`, `COMPANY`, `CONTACT`, `DEAL`), `0` quando não há vínculo.
  É o que o app lê para as ações dos gatilhos (`triggers/actions/crm-binding.ts`).
- `entity_data_1`: começa com `Y` (vinculado ao CRM) e a entidade principal (`DEAL|27134`); os
  segmentos seguintes não foram identificados.
- `entity_id`: conector, linha, id do cliente no conector e usuário (aqui, uma linha de WhatsApp).
