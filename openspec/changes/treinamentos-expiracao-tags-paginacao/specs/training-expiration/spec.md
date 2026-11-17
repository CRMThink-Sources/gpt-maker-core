## Purpose

Permite que um treinamento manual do agente tenha prazo de validade: vencido o prazo, o sistema o retira do GPTMaker automaticamente e o mostra como expirado, para o agente não responder com conteúdo desatualizado e o plano não ficar ocupado por itens que já não valem.

## ADDED Requirements

### Requirement: Definir a expiração de um treinamento
O sistema MUST permitir a quem gerencia agentes informar, na criação e na edição de um treinamento manual de qualquer tipo, uma data e hora de expiração opcional, e remover a expiração de um treinamento que a tenha. A data MUST estar no futuro ao ser definida. Treinamentos gerados pela função do agente MUST NOT aceitar expiração. Quem apenas consulta MUST NOT poder alterar a expiração. Agente de outro tenant MUST responder como se não existisse.

#### Scenario: Criar com expiração
- **WHEN** o administrador cria um treinamento de texto com expiração daqui a 7 dias
- **THEN** o treinamento é criado normalmente e a lista mostra a data de expiração dele

#### Scenario: Data no passado
- **WHEN** o administrador informa uma expiração anterior ao momento atual
- **THEN** o sistema recusa e informa que a data precisa ser futura

#### Scenario: Alterar ou remover a expiração
- **WHEN** o administrador troca a data de um treinamento de site, ou limpa a data de um de vídeo
- **THEN** o treinamento muda só a expiração (sem ser reenviado ao GPTMaker) e a lista reflete a nova situação

#### Scenario: Treinamento gerado pela função
- **WHEN** alguém tenta definir expiração num treinamento gerado pela função do agente
- **THEN** o sistema recusa

#### Scenario: Perfil somente consulta
- **WHEN** um usuário sem permissão de gerenciar tenta definir a expiração
- **THEN** o sistema recusa

### Requirement: Expirar treinamentos vencidos
O sistema MUST, por um processo periódico em segundo plano, expirar todo treinamento cuja data de expiração tenha passado: remover o treinamento no GPTMaker e marcá-lo como expirado, registrando o momento. O treinamento MUST NOT ser apagado da aplicação: ele continua listado com o estado expirado. Treinamento já removido no GPTMaker MUST ser tratado como removido com sucesso. Em caso de falha ao remover no GPTMaker, o treinamento MUST permanecer como estava e ser tentado de novo na execução seguinte, sem afetar os demais. A expiração MUST ocorrer no máximo uma vez por treinamento, mesmo com várias instâncias do processo ativas.

#### Scenario: Expiração no prazo
- **WHEN** a data de expiração de um treinamento concluído passa
- **THEN** em até 15 minutos o treinamento deixa de existir no GPTMaker e a lista o mostra como expirado

#### Scenario: Falha no GPTMaker
- **WHEN** o GPTMaker está indisponível quando o prazo vence
- **THEN** o treinamento continua ativo e é expirado numa execução posterior, quando a remoção funcionar

#### Scenario: Já removido no GPTMaker
- **WHEN** o treinamento vencido já não existe no GPTMaker
- **THEN** ele é marcado como expirado sem erro

#### Scenario: Um treinamento com falha não bloqueia os outros
- **WHEN** a remoção de um treinamento vencido falha e há outros vencidos
- **THEN** os outros são expirados normalmente

#### Scenario: Treinamento ainda em processamento
- **WHEN** um treinamento vence enquanto está em processamento ou com falha
- **THEN** ele também é removido do GPTMaker (se existir lá) e marcado como expirado

### Requirement: Efeitos de um treinamento expirado
Um treinamento expirado MUST NOT contar no limite de treinamentos nem no de armazenamento do plano, e o documento ou a imagem dele MUST ser removido do armazenamento. O texto, o endereço e as tags MUST continuar visíveis na lista. Um treinamento expirado MUST NOT ser reenviado ao GPTMaker nem recriado por sincronização, MUST NOT ser editável nem reenviável, e MUST poder ser removido da lista pelo usuário que gerencia.

#### Scenario: Libera espaço no plano
- **WHEN** um treinamento de documento expira
- **THEN** o uso de treinamentos e de armazenamento mostrado ao cliente diminui

#### Scenario: Sem edição nem reenvio
- **WHEN** o usuário olha um treinamento expirado
- **THEN** a tela mostra o selo "Expirado" e a data, e não oferece editar nem reenviar

#### Scenario: Sincronização não recria
- **WHEN** a sincronização com o GPTMaker roda depois da expiração
- **THEN** o treinamento expirado continua expirado e nada é criado no GPTMaker por causa dele

#### Scenario: Remover da lista
- **WHEN** o administrador remove um treinamento expirado
- **THEN** ele some da lista sem nova chamada de remoção ao GPTMaker
