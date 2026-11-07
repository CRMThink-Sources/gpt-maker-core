# Proposal

## Why

Duas telas do agente cansam no uso real. Na aba Função, a coluna do meio (o formulário) é estreita: o conteúdo está limitado a `max-w-4xl` e ainda divide o espaço com a lateral de 15rem, então sobra cerca de 40rem para o formulário. Na base de conhecimento, cada item é um cartão aberto com todos os campos, e a lista de treinamentos mostra tudo de uma vez. Com muitos itens a página fica enorme para rolar.

## What Changes

- Alargar a coluna central da aba Função: a área de conteúdo do app passa de `max-w-5xl` para `max-w-6xl` e o formulário deixa de ser limitado a `max-w-4xl`.
- Itens da base de conhecimento (formulário da Função) viram cartões recolhíveis. Recolhido mostra número, título, contador de caracteres e remover. Item novo abre expandido, e os demais recolhem quando a lista passa de 3 itens. Botões "Expandir todos" e "Recolher todos" quando há mais de 3 itens.
- Aba Treinamentos: busca por texto e paginação "Mostrar mais" (20 por vez) quando a lista é longa.
- Sem mudança de dados, API ou regra de negócio.

## Capabilities

### New Capabilities
<!-- Nenhuma: ajuste puramente visual. -->

### Modified Capabilities
<!-- Nenhuma: nenhum requisito de comportamento muda (skip_specs). -->

## Impact

- `frontend/src/app/app/app-shell.tsx` (largura do conteúdo, afeta todas as páginas do app).
- `frontend/src/app/app/agents/[id]/function/page.tsx` (largura do formulário e da lateral).
- `frontend/src/app/app/agents/function-form.tsx` (campo de base de conhecimento recolhível).
- `frontend/src/app/app/agents/[id]/trainings/page.tsx` (busca e "Mostrar mais").
- Testes de componente existentes do formulário e dos treinamentos precisam cobrir o recolhimento e o filtro.
