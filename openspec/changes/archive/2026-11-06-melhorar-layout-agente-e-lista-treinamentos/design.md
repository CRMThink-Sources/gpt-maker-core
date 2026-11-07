# Design

## Context

Ver proposal.md. O conteúdo do app fica em `mx-auto max-w-5xl` (app-shell). A página Função ainda aplica `max-w-4xl` e, em telas `xl`, uma grade `1fr + 15rem`. O campo `KNOWLEDGE` renderiza todos os itens expandidos, com subcampos e imagem.

## Goals / Non-Goals

**Goals:**
- Formulário mais largo sem quebrar o layout em telas pequenas.
- Lista de itens navegável com dezenas de itens, sem perder erros de validação.

**Non-Goals:**
- Mudar contratos, limites (`maxItems`) ou o modelo de dados.
- Virtualização de lista ou paginação no servidor.

## Decisions

- **Largura**: `max-w-6xl` no shell e remover `max-w-4xl` da página Função; lateral de 15rem → 16rem. A coluna central passa de ~40rem para ~54rem em telas `xl`. Alternativa descartada: alargar só a página Função, pois o shell a limita de qualquer forma; alargar o shell é uma mudança de uma linha e afeta de leve as demais páginas, que já se adaptam por serem fluidas.
- **Itens recolhíveis**: estado local `open: Set<itemKey>` no componente do campo, sem persistir. Cabeçalho do cartão vira botão com `aria-expanded`. Itens com erro de validação abrem sozinhos para o erro não ficar escondido. Item recém-criado abre; com mais de 3 itens, os outros recolhem. Alternativa descartada: rolagem interna com altura fixa, pior em celular e com foco/teclado.
- **Treinamentos**: filtro por texto no cliente sobre o título e `visible = 20` com "Mostrar mais (+20)". A busca zera o limite. Alternativa descartada: paginação no servidor, pois a API devolve a lista inteira hoje e o volume por agente é baixo.

## Risks / Trade-offs

- [Shell mais largo muda outras telas] → conferir visualmente Agentes, Admin do app e Consumo; todas são fluidas.
- [Erro de validação em item recolhido passar despercebido] → abrir automaticamente itens com erro e manter o contador de erros no cabeçalho.
- [Polling atualiza a lista com filtro ativo] → o filtro é derivado do estado, então persiste entre atualizações.
