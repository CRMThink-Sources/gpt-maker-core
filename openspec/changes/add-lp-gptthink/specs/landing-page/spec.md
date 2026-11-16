# Spec Delta

## Purpose
Página pública de apresentação do GPTThink para quem acabou de instalar o app e para quem quer conhecê-lo, no mesmo padrão das landing pages dos demais apps da CRMThink.

## ADDED Requirements

### Requirement: Rotas públicas por idioma
O sistema SHALL servir a landing page do GPTThink sem exigir sessão, em `/lp/gptthink` (pt-BR), `/lp/gptthink/en` (inglês) e `/lp/gptthink/es` (espanhol). Qualquer outro valor no segmento de idioma, inclusive `pt-BR`, SHALL responder 404. A página SHALL NOT depender do Bitrix24 nem do backend para ser exibida.

#### Scenario: Idioma suportado
- **WHEN** um visitante abre `/lp/gptthink/es`
- **THEN** a página aparece em espanhol, sem login

#### Scenario: Português na URL base
- **WHEN** um visitante abre `/lp/gptthink`
- **THEN** a página aparece em português

#### Scenario: Idioma inexistente
- **WHEN** um visitante abre `/lp/gptthink/fr` ou `/lp/gptthink/pt-BR`
- **THEN** a resposta é 404

### Requirement: Seletor de idioma
A página SHALL oferecer links para as três versões e SHALL marcar a versão atual. O idioma da página SHALL ser declarado no próprio conteúdo (`lang`).

#### Scenario: Troca de idioma
- **WHEN** o visitante escolhe English no seletor da versão em português
- **THEN** ele vai para `/lp/gptthink/en` e a versão em inglês aparece marcada como atual

### Requirement: Estrutura e conteúdo da página
A página SHALL conter, nesta ordem: cabeçalho (âncoras Funcionalidades, Primeiros passos e Dúvidas, seletor de idioma e botão Instalar), hero com mockup de conversa, grade de funcionalidades, Primeiros passos, perguntas frequentes, chamada final para instalar e rodapé. A página SHALL NOT exibir preços, planos, valores de créditos, depoimentos nem formulário.

#### Scenario: Âncoras do cabeçalho
- **WHEN** o visitante aciona uma âncora do cabeçalho
- **THEN** a página rola até a seção correspondente

#### Scenario: Sem preços
- **WHEN** o visitante percorre a página
- **THEN** nenhuma seção mostra preço, plano ou valor de créditos

### Requirement: Primeiros passos como tutorial simulado
A seção Primeiros passos SHALL apresentar abas (Instalação, Criar o agente, Treinar, Intenções e funções, Canal aberto, Créditos e plano), cada uma com três passos. Cada passo SHALL mostrar o indicador "Passo X de N", um título, um texto, a dica com o nome do elemento em destaque e uma **tela simulada** do Bitrix24 ou do app, dentro de uma janela de navegador, em que exatamente um elemento tem o destaque laranja. Acionar o destaque, Próximo ou uma das bolinhas numeradas SHALL levar ao passo correspondente. Voltar SHALL ficar indisponível no primeiro passo, e no último passo Próximo SHALL virar Concluir, que recomeça a aba pelo primeiro passo. Ao trocar de aba, a navegação SHALL voltar ao primeiro passo. As telas simuladas SHALL usar os nomes reais da interface do app no idioma da página e SHALL NOT exibir preços, planos nem valores de créditos.

#### Scenario: Clicar no destaque
- **WHEN** o visitante aciona o elemento em destaque laranja da tela simulada
- **THEN** o passo seguinte aparece e o indicador mostra "Passo 2 de 3"

#### Scenario: Navegar pelos passos
- **WHEN** o visitante aciona Próximo no primeiro passo de uma aba
- **THEN** o segundo passo aparece, com a tela simulada correspondente

#### Scenario: Ir direto a um passo
- **WHEN** o visitante aciona a bolinha do passo 3
- **THEN** o terceiro passo aparece e a bolinha fica marcada como a atual

#### Scenario: Limites
- **WHEN** o visitante está no primeiro passo
- **THEN** Voltar está indisponível; no último passo, o botão de avançar mostra Concluir

#### Scenario: Concluir
- **WHEN** o visitante aciona Concluir no último passo
- **THEN** a aba recomeça pelo primeiro passo

#### Scenario: Troca de aba
- **WHEN** o visitante está no terceiro passo de uma aba e escolhe outra aba
- **THEN** a nova aba abre no primeiro passo

#### Scenario: Teclado
- **WHEN** o visitante usa as setas, Home ou End com uma aba em foco
- **THEN** a seleção e o foco vão para a aba correspondente, que abre no primeiro passo

### Requirement: Chamadas para instalar
Todo botão de instalar da página SHALL levar ao Market do Bitrix24, em nova aba, sem repassar ao destino a página de origem. O endereço SHALL ser sempre um link `https`.

#### Scenario: Clique em Instalar
- **WHEN** o visitante aciona qualquer botão Instalar
- **THEN** o Market do Bitrix24 abre em nova aba e a página continua aberta

### Requirement: Metadados por idioma
Cada versão SHALL ter título e descrição próprios no idioma da página, endereço canônico da própria versão e referências `hreflang` para as três versões.

#### Scenario: Versões alternativas
- **WHEN** um buscador lê a versão em inglês
- **THEN** encontra o endereço canônico `/lp/gptthink/en` e as alternativas para pt-BR, en e es
