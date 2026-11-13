## ADDED Requirements

### Requirement: Idiomas suportados
O portal do cliente (`/app`) SHALL suportar `pt-BR`, `en` e `es`. Qualquer outro idioma SHALL cair em `en`.

#### Scenario: Idioma não suportado
- **WHEN** o portal Bitrix está em um idioma que não é português, inglês nem espanhol
- **THEN** a interface é exibida em `en`

### Requirement: Detecção do idioma
O idioma inicial SHALL ser, em ordem: preferência salva pelo usuário, idioma do portal Bitrix (`BX24.getLang()`: `br`→`pt-BR`, `la`→`es`, `en`→`en`), `en`.

#### Scenario: Primeiro acesso em portal brasileiro
- **WHEN** um usuário sem preferência salva abre o app em um portal com idioma `br`
- **THEN** a interface aparece em `pt-BR`

#### Scenario: Preferência prevalece
- **WHEN** o usuário escolheu `es` e o portal está em `br`
- **THEN** a interface aparece em `es`

### Requirement: Troca manual de idioma
O app SHALL oferecer um seletor de idioma que aplica a troca sem recarregar a sessão e persiste a escolha.

#### Scenario: Troca
- **WHEN** o usuário seleciona `en`
- **THEN** os textos mudam para inglês, `<html lang>` vira `en` e a escolha é lembrada no próximo acesso

### Requirement: Cobertura completa dos textos
Todo texto visível ao usuário no `/app` SHALL vir dos dicionários, e os três dicionários SHALL ter exatamente o mesmo conjunto de chaves.

#### Scenario: Chave ausente
- **WHEN** uma chave existe em `pt-BR` e falta em `es`
- **THEN** o teste de paridade falha

### Requirement: Formatação localizada
Datas, horas e números SHALL ser formatados conforme o idioma ativo. Valores monetários SHALL continuar em BRL, formatados no idioma ativo.

#### Scenario: Data em inglês
- **WHEN** o idioma ativo é `en`
- **THEN** datas seguem o formato `en-US` e valores aparecem como `R$` com separadores `en-US`

### Requirement: Erros de API traduzidos por código
O frontend SHALL traduzir erros usando `error.code`; sem tradução para o código, SHALL exibir `error.message` recebido.

#### Scenario: Código conhecido
- **WHEN** a API responde `AGENT_CREATION_IN_PROGRESS` e o idioma é `en`
- **THEN** a mensagem exibida está em inglês

#### Scenario: Código sem tradução
- **WHEN** a API responde um código sem entrada no dicionário
- **THEN** é exibido o `message` original
