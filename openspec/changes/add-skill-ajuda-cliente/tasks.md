## 1. Conteúdo

- [ ] 1.1 Adicionar ao `FunctionCatalog` a consulta das funções abertas a todos (publicadas, ativas, não excluídas, sem restrição de portais; última versão). Verificar no teste de integração do 2.3.
- [x] 1.2 Criar a montagem em Markdown do formulário (lista de permitidos, design D3) com testes unitários: campos dependentes, base de conhecimento, processo inteligente e ausência de todo texto interno. Verificar: `npm test`.
- [ ] 1.3 Escrever o guia em Markdown a partir do código, das specs e da página Ajuda, sem preços, créditos, fornecedor ou backoffice. Verificar: revisão do texto pelo usuário.

## 2. API e pacote

- [x] 2.1 Escrever o `SKILL.md` modelo (URL do conteúdo e suporte preenchidos na geração).
- [x] 2.2 Criar o módulo `help-skill` com `GET /public/help-skill/content` e `/download` (zip, `Content-Disposition`, `Cache-Control`) e registrá-lo em `domain.modules.ts`; testes unitários do pacote, com e sem suporte.
- [ ] 2.3 Teste de integração das duas rotas: sem sessão; função restrita, inativa, excluída e não publicada de fora. Verificar: `npm run test:integration -w backend`.
- [x] 2.4 Copiar os Markdown no build (`nest-cli.json`) e repassar `PUBLIC_SUPPORT_URL` à API nos composes e `.env*.example`. Verificar: `npm run build` e arquivos presentes em `backend/dist`.

## 3. Frontend

- [x] 3.1 Ler a documentação do Next em `node_modules/next/dist/docs/` e criar o cartão na página Ajuda (botão, instalação, liberação do acesso) com textos em `pt-BR`, `en` e `es`. (Documentação não consultada: o cartão usa só HTML num componente cliente, sem API do Next.)
- [x] 3.2 Testes do cartão em `help/page.test.tsx` (link de download em nova aba, instruções, idioma). Verificar: `npx vitest run` em `frontend/`.

## 4. Verificação

- [ ] 4.1 Rodar a verificação do CI descrita no `CLAUDE.md` e os revisores `revisor-codigo`, `auditor-multitenant` e `revisor-frontend`.
- [ ] 4.2 Numa conta real do claude.ai, instalar o `.zip` e perguntar com e sem o domínio liberado; ajustar o texto de liberação conforme o resultado.
- [ ] 4.3 No staging, baixar a skill pelo portal dentro do iframe do Bitrix.
