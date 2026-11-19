## Purpose

Página de Ajuda do portal do cliente (`/app`): reúne orientação básica de uso e o caminho até o suporte, para que o cliente resolva dúvidas comuns sem sair do app.

## ADDED Requirements

### Requirement: Página Ajuda no portal do cliente
O portal do cliente (`/app`) SHALL ter uma página **Ajuda** acessível pelo menu lateral, disponível a todos os papéis (administrador, gerente de agentes e somente leitura), tanto no menu fixo (desktop) quanto na gaveta (celular). A página SHALL conter um guia de primeiros passos e perguntas frequentes agrupadas por tema.

#### Scenario: Usuário somente leitura
- **WHEN** um usuário sem permissão de gerenciar agentes aciona o item Ajuda
- **THEN** a página abre com o guia de primeiros passos e as perguntas frequentes

#### Scenario: Menu no celular
- **WHEN** o usuário aciona o item Ajuda na gaveta do menu
- **THEN** a página abre e a gaveta fecha

### Requirement: Perguntas frequentes por tema
As perguntas frequentes SHALL ser agrupadas por tema e cada pergunta SHALL poder ser expandida e recolhida pelo usuário, com todas recolhidas ao abrir a página. Os temas SHALL cobrir ao menos: criar e treinar o agente, créditos e plano, atendimento no canal aberto e transferência para humano.

#### Scenario: Expandir uma pergunta
- **WHEN** o usuário aciona uma pergunta recolhida
- **THEN** a resposta fica visível e as demais perguntas mantêm seu estado

### Requirement: Atalho para o suporte na página
A página Ajuda SHALL oferecer um botão para falar com o suporte quando o canal de suporte estiver configurado no ambiente, abrindo-o em nova aba sem repassar a página de origem. Sem canal configurado, o botão SHALL NOT aparecer e o restante da página SHALL funcionar normalmente.

#### Scenario: Canal configurado
- **WHEN** o usuário aciona o botão de suporte da página Ajuda
- **THEN** o canal abre em nova aba e o app continua na página Ajuda

#### Scenario: Canal não configurado
- **WHEN** o ambiente não define o canal de suporte
- **THEN** a página Ajuda não mostra o botão de suporte e continua exibindo guia e perguntas

### Requirement: Textos da Ajuda em três idiomas
Todo o texto da página Ajuda e do seu item de menu SHALL existir em `pt-BR`, `en` e `es` e seguir o idioma ativo da interface, com o mesmo conjunto de chaves nos três dicionários.

#### Scenario: Idioma da interface
- **WHEN** a interface está em `en`
- **THEN** o item de menu, o guia e as perguntas aparecem em inglês
