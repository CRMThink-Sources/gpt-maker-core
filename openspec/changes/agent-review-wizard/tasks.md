# Tasks

## 1. Lógica pura da fila

- [ ] 1.1 Criar `review-wizard.ts` com `buildWizardSteps(review, form, answers)`: passos de sugestão, lacuna e contradição na ordem do design (D1), chaves estáveis, campos desatualizados em `outdated`, passos já aplicados ou adicionados fora da fila. Verificação: testes unitários para ordem, campo desatualizado fora da fila e contado, item já aplicado pelo resultado inline fora da fila, e sugestão sem `applicable` mantida como passo só de leitura
- [ ] 1.2 Em `review-wizard.ts`, `wordDiff(antes, depois)` por maior subsequência de palavras, preservando espaços, com a regra de pouca semelhança (sem destaque quando menos de 30% das palavras são comuns). Verificação: testes para troca de uma palavra, acréscimo, remoção, textos iguais, texto vazio no antes e reescrita total sem destaque
- [ ] 1.3 Em `review-wizard.ts`, `placeholderSlots(values)` e `fillPlaceholders(values, filled)` (D5): um campo por ocorrência de `[preencher: …]`, rótulo pelo texto do marcador, em branco mantém o marcador. Verificação: testes com dois marcadores no mesmo subcampo, marcadores em subcampos diferentes, preenchido, em branco e valor com colchetes

## 2. Modal e casca do assistente

- [ ] 2.1 Adicionar `trapFocus` opcional ao `Modal` (D7): guarda o foco ao abrir, foca o diálogo, cicla o Tab e devolve o foco ao fechar; sem a opção, nada muda. Verificação: teste do `Modal` com a opção (Tab cicla, foco volta ao botão de origem) e sem ela (comportamento atual intacto)
- [ ] 2.2 Criar o componente `ReviewWizard` com o estado local (D2): posição ancorada na chave do passo, pular, voltar, progresso "N de M", região `aria-live` com o anúncio do passo e `aria-labelledby`. Verificação: testes com passos falsos para avançar, pular, voltar, progresso, anúncio do passo e posição mantida quando a fila muda
- [ ] 2.3 Atalhos de teclado (D6): Enter aplica ou adiciona, setas pulam e voltam, Ctrl/Cmd+Enter confirma a edição, nada disso dentro de `input`, `textarea` ou `select`, Esc fecha. Verificação: testes disparando cada tecla, inclusive a seta com o foco numa textarea (não pula) e Esc devolvendo o foco ao botão
- [ ] 2.4 Resumo final: aplicadas, puladas, adicionadas, puladas por desatualização, marcadores pendentes com link ao campo e o lembrete de que nada foi publicado. Verificação: teste do cenário "aplica 4, pula 2, adiciona 1 com marcador em branco" conferindo contagens, a lista de pendências e o link

## 3. Passos

- [ ] 3.1 Passo de sugestão: caminho (campo › item), motivo, ANTES e SUGERIDO lado a lado com `wordDiff`, por subcampo na base; Aplicar via `canApply` e `withSuggestion`; Editar com textarea, contador e limite, desativando Aplicar quando a validação recusa; sugestão sem `applicable` só para leitura com o motivo. Verificação: testes de aplicar (chama `onApply` com os valores), editar e aplicar o texto editado, edição acima do limite com o botão desativado e sugestão não aplicável sem o botão
- [ ] 3.2 Passo de lacuna: item sugerido com um campo por marcador (D5), "Adicionar" via `canAddGap` sobre o item preenchido, aviso de publicação recusada quando algum marcador fica em branco, campo cheio ou item inválido só com o motivo e Pular. Verificação: testes de completar marcador (o item chega preenchido), adicionar com marcador em branco (aviso e item com o marcador), campo cheio e valor longo demais desativando o botão
- [ ] 3.3 Passo de contradição informativo, com "Ir ao campo" (fecha, rola e foca o campo, D9) e "Continuar". Verificação: teste de "Ir ao campo" chamando o fechamento e a navegação para o campo de primeiro nível certo, e de "Continuar" avançando sem alterar respostas
- [ ] 3.4 Layout responsivo (D10): colunas empilhadas no celular, ações no rodapé fixo do modal, dica dos atalhos só em tela larga. Verificação: teste de snapshot de classes (`grid-cols-1 sm:grid-cols-2`) e conferência manual em largura de celular, registrada no corpo do PR

## 4. Integração na página

- [ ] 4.1 Extrair de `FieldNotes` o caminho de aplicar para `applySuggestion(fieldId, index, values)` na página (`setAnswers` mais `review.applied`) e usá-lo no assistente e no resultado inline. Verificação: os testes atuais de "Aplicar" no campo continuam verdes e um teste novo confirma que o assistente e o inline produzem a mesma resposta
- [ ] 4.2 Botão "Aplicar sugestões (N)" no painel de revisão (só com N > 0) e abertura automática ao terminar a revisão, uma vez por execução (D8), sem abrir quando a revisão falhou. Verificação: testes com o hook falso para abrir ao terminar, não abrir sem passo acionável, não reabrir sozinho depois de fechado e o botão devolvendo o foco ao fechar
- [ ] 4.3 Teste de ponta a ponta da tela com API falsa: revisar, o assistente abre, aplicar uma sugestão, completar um marcador e adicionar a lacuna, ler o resumo e conferir as respostas no formulário. Verificação: o teste passa e as respostas finais batem com as ações feitas
- [ ] 4.4 `openspec validate agent-review-wizard --strict`, `npm run build` e os testes do `frontend`; teste manual no Suporte com SPA (revisão com expectativa, percorrer a fila com mouse e só com teclado, celular). Verificação: tudo verde e o roteiro manual registrado em `docs/vibecode-observado.md`
