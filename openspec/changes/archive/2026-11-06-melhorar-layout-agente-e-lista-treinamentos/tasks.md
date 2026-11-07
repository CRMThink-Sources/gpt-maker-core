# Tasks

## 1. Largura da coluna central

- [x] 1.1 Trocar `max-w-5xl` por `max-w-6xl` em `app-shell.tsx`, remover `max-w-4xl` e ajustar a lateral para 16rem em `[id]/function/page.tsx`; verificar no navegador em 1280px e 1536px que o formulário ocupa mais largura e que em celular não há rolagem horizontal
- [x] 1.2 Conferir as páginas Agentes, Admin e Consumo no novo `max-w-6xl` e rodar `npm run typecheck` e `npm run lint` no frontend sem erros

## 2. Base de conhecimento recolhível

- [x] 2.1 Tornar os cartões do campo `KNOWLEDGE` em `function-form.tsx` recolhíveis (botão com `aria-expanded`, item novo aberto, recolher os demais acima de 3 itens, abrir itens com erro) e verificar com teste de componente que alterna, que item com erro abre e que o contador continua visível recolhido
- [x] 2.2 Adicionar "Expandir todos" / "Recolher todos" quando houver mais de 3 itens e verificar com teste que os botões alteram todos os cartões
- [x] 2.3 Rodar `function-form.test.tsx` e os testes de revisão existentes e verificar que continuam passando

## 3. Lista de treinamentos longa

- [x] 3.1 Em `[id]/trainings/page.tsx`, adicionar campo de busca por título e "Mostrar mais" de 20 em 20, com estado vazio para busca sem resultado; verificar com teste de componente (25 itens mostra 20 + botão; busca filtra; busca sem resultado mostra mensagem)
- [x] 3.2 Rodar a suíte do frontend (`npm test`) e conferir no navegador uma lista com mais de 20 treinamentos
