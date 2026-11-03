# Spec Delta

## Purpose

Guia o cliente, um item por vez, para aplicar as sugestões, adicionar os itens das lacunas e ler as contradições da revisão por IA, sem caçar o resultado pelo formulário.

## ADDED Requirements

### Requirement: Abertura do assistente
O assistente MUST abrir sozinho quando a revisão por IA terminar com ao menos um passo acionável, e MUST poder ser reaberto pelo botão "Aplicar sugestões", que mostra quantos passos restam. Sem passo acionável, o assistente MUST NOT abrir sozinho, e o botão MUST NOT aparecer. Fechar o assistente MUST NOT descartar o resultado da revisão nem o que já foi aplicado.

#### Scenario: Abre ao terminar
- **WHEN** a revisão termina com 5 sugestões e 2 lacunas
- **THEN** o assistente abre no primeiro passo, mostrando "1 de 7"

#### Scenario: Nada a aplicar
- **WHEN** a revisão termina sem sugestão, sem lacuna e sem contradição
- **THEN** o assistente não abre e o botão "Aplicar sugestões" não aparece

#### Scenario: Reabrir depois de fechar
- **WHEN** o cliente fecha o assistente no passo 3 e clica em "Aplicar sugestões (4)"
- **THEN** o assistente abre no primeiro passo ainda pendente e os passos já aplicados não voltam

### Requirement: Fila de passos
O assistente MUST apresentar os passos nesta ordem: sugestões de texto, lacunas da base e contradições. Cada sugestão ou lacuna MUST ser um passo; cada contradição MUST ser um passo informativo. Um passo MUST mostrar o caminho (campo e item), o motivo (o problema apontado ou o porquê da lacuna) e o progresso "N de M". O cliente MUST poder voltar ao passo anterior. Um passo cujo campo foi editado depois da revisão (resultado desatualizado) MUST ser pulado, com um aviso no fim.

#### Scenario: Ordem dos passos
- **WHEN** há 2 sugestões, 1 lacuna e 1 contradição
- **THEN** os passos vêm como sugestão, sugestão, lacuna, contradição

#### Scenario: Voltar
- **WHEN** o cliente pula o passo 2 e clica em "Voltar"
- **THEN** o passo 2 aparece de novo, ainda pendente

#### Scenario: Campo editado depois da revisão
- **WHEN** o cliente editou à mão o campo "FAQ" depois da revisão e abre o assistente
- **THEN** os passos desse campo não aparecem e o resumo final diz que foram pulados por estarem desatualizados

### Requirement: Passo de sugestão de texto
O passo de uma sugestão MUST mostrar o texto atual (ANTES) e o texto sugerido lado a lado, com as diferenças destacadas por palavra, e MUST oferecer Aplicar, Editar e Pular. Aplicar MUST trocar o texto no formulário pelo mesmo caminho da digitação, sem salvar nem publicar, e MUST seguir para o passo seguinte. Editar MUST abrir o texto sugerido para ajuste, com contador de caracteres e o limite do campo, e MUST NOT permitir aplicar acima do limite nem com subcampo obrigatório vazio. Sugestão que não pode ser aplicada (`applicable` falso) MUST aparecer só para leitura, dizendo o motivo, com Pular.

#### Scenario: Aplicar e seguir
- **WHEN** o cliente clica em "Aplicar" na sugestão do item 2 de "Problemas comuns"
- **THEN** o texto do item no formulário passa a ser o sugerido, o formulário fica com alterações não salvas e o passo seguinte aparece

#### Scenario: Editar antes de aplicar
- **WHEN** o cliente clica em "Editar", troca duas palavras e aplica
- **THEN** o formulário recebe o texto editado, não o original sugerido

#### Scenario: Edição acima do limite
- **WHEN** o cliente edita o texto até passar do limite do subcampo
- **THEN** o contador fica em alerta e "Aplicar" fica desativado

#### Scenario: Sugestão não aplicável
- **WHEN** a sugestão tem 900 caracteres e o subcampo aceita 850
- **THEN** o passo mostra a sugestão só para leitura com o motivo e a opção de pular

### Requirement: Passo de lacuna
O passo de uma lacuna MUST mostrar o item sugerido, e cada trecho `[preencher: …]` MUST virar um campo de texto nomeado pelo que falta, que o cliente completa antes de adicionar. "Adicionar" MUST inserir o item no fim do campo de base, já com os trechos preenchidos, sem salvar nem publicar, e seguir para o passo seguinte. O cliente MUST poder adicionar com marcadores em branco, e o passo MUST avisar que a publicação será recusada enquanto houver marcador. A lacuna MUST NOT oferecer "Adicionar" quando o campo está cheio ou o item não passa nas regras do campo; mostra então o motivo e Pular.

#### Scenario: Completar marcadores
- **WHEN** o rascunho diz "Reembolso em [preencher: prazo em dias] dias" e o cliente digita "7"
- **THEN** o item adicionado diz "Reembolso em 7 dias" e não tem marcador pendente

#### Scenario: Adicionar com marcador em branco
- **WHEN** o cliente adiciona sem preencher um marcador
- **THEN** o item entra com o marcador, o resumo final o lista como pendente e a publicação continua recusada até ele ser preenchido

#### Scenario: Campo cheio
- **WHEN** o campo "Políticas" já está no máximo de itens
- **THEN** o passo mostra "O campo já está no máximo de itens" e só oferece Pular

### Requirement: Passo de contradição
O passo de uma contradição MUST ser informativo: mostra o texto e os campos envolvidos e oferece "Ir ao campo", que fecha o assistente e leva o cliente ao primeiro campo citado, e "Continuar". O assistente MUST NOT alterar nada por conta de uma contradição.

#### Scenario: Ir ao campo
- **WHEN** a contradição cita "Políticas" e "FAQ" e o cliente clica em "Ir ao campo"
- **THEN** o assistente fecha e a tela rola até "Políticas"

### Requirement: Teclado, acessibilidade e celular
O assistente MUST funcionar só com o teclado: Enter aplica ou adiciona o passo quando possível (e Ctrl ou Cmd com Enter confirma a edição de texto), a seta para a direita pula, a seta para a esquerda volta e Esc fecha, sem disparar esses atalhos enquanto o cliente digita num campo. O foco MUST ficar preso no modal e voltar ao botão de abertura ao fechar. A troca de passo MUST ser anunciada para leitores de tela. No celular, ANTES e SUGERIDO MUST aparecer um sobre o outro, e as ações MUST ficar visíveis sem rolar.

#### Scenario: Atalho enquanto digita
- **WHEN** o cliente digita num campo de edição e pressiona a seta para a direita
- **THEN** o cursor se move no texto e o passo não é pulado

#### Scenario: Esc fecha
- **WHEN** o cliente pressiona Esc
- **THEN** o assistente fecha e o foco volta ao botão "Aplicar sugestões"

### Requirement: Resumo final
Ao terminar a fila, o assistente MUST mostrar um resumo com quantas sugestões foram aplicadas, quantas puladas, quantos itens foram adicionados, quantos passos foram pulados por desatualização e os marcadores `[preencher: …]` ainda pendentes, cada um com o link para o campo. O resumo MUST lembrar que nada foi salvo nem publicado. Fechar o resumo MUST deixar o formulário com as alterações aplicadas.

#### Scenario: Resumo com pendências
- **WHEN** o cliente aplica 4, pula 2 e adiciona 1 item com um marcador em branco
- **THEN** o resumo mostra "4 aplicadas, 2 puladas, 1 adicionado", lista o marcador pendente com o link para o campo e avisa que nada foi publicado
