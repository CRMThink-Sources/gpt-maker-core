## ADDED Requirements

### Requirement: Acesso ao suporte no menu do app
O portal do cliente (`/app`) SHALL exibir no menu lateral um item **Suporte** que leva o usuário ao canal direto com a CRMThink. O item SHALL ficar visível para todos os usuários do portal, inclusive administradores, gerentes e usuários somente leitura, e SHALL estar disponível no menu fixo (desktop) e na gaveta (celular).

#### Scenario: Usuário somente leitura
- **WHEN** um usuário sem permissão de gerenciar agentes abre o app com o canal de suporte configurado
- **THEN** o item Suporte aparece no menu

#### Scenario: Menu no celular
- **WHEN** o usuário abre a gaveta do menu em tela pequena
- **THEN** o item Suporte aparece e, ao ser acionado, a gaveta fecha

### Requirement: Abertura do canal em nova aba
Ao acionar o item Suporte, o app SHALL abrir o link do canal em uma **nova aba**, sem substituir nem recarregar a tela do app dentro do Bitrix24, e sem repassar ao destino a página de origem.

#### Scenario: Clique no item
- **WHEN** o usuário aciona o item Suporte
- **THEN** o link do canal abre em uma nova aba e o app continua na tela em que estava

### Requirement: Canal configurável por ambiente
O endereço do canal de suporte SHALL vir de configuração do ambiente, para que staging e produção possam apontar para canais diferentes sem novo build. Quando não houver endereço configurado (ausente ou vazio), o item Suporte SHALL NOT aparecer e o app SHALL funcionar normalmente.

#### Scenario: Canal não configurado
- **WHEN** o ambiente não define o endereço do canal de suporte
- **THEN** o menu não mostra o item Suporte e nenhuma outra tela é afetada

#### Scenario: Troca de canal sem novo build
- **WHEN** o endereço do canal muda na configuração do ambiente e o serviço é reiniciado
- **THEN** o item Suporte passa a abrir o novo endereço

### Requirement: Textos do item de suporte em três idiomas
Os textos do item Suporte SHALL existir em `pt-BR`, `en` e `es` e seguir o idioma ativo da interface.

#### Scenario: Idioma da interface
- **WHEN** a interface está em `es`
- **THEN** o item Suporte aparece com o texto em espanhol
