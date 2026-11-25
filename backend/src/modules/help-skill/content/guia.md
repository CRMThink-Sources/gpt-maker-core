## O que é o GPTThink

Aplicativo do Bitrix24 para criar, configurar e treinar agentes de IA que atendem os clientes nos canais abertos. Você não escreve prompt: escolhe uma função para o agente e responde um formulário sobre o seu negócio.

Menu do aplicativo: **Agentes**, **Créditos e plano**, **Configurações** (Permissões, Avisos), **Avançado** (CRM para o agente, Chave Vibecode) e **Suporte** (Ajuda e Falar com o suporte). Alguns itens aparecem só para administradores ou conforme o que está disponível no seu portal.

## Quem pode fazer o quê

Administradores do portal sempre podem criar, editar, treinar agentes e configurar gatilhos. Em **Permissões**, um administrador autoriza outros usuários. Os demais só consultam. Se os botões de edição não aparecem, peça acesso a um administrador.

## Criar um agente

Em **Agentes**, clique em **Novo agente** e siga os quatro passos:

1. **Função**: o que o agente vai fazer. Cada agente tem uma função.
2. **Identidade**: o nome que o cliente vê no chat, a foto (opcional, link https de uma imagem quadrada) e o modelo de IA.
3. **Formulário**: perguntas sobre o seu negócio. O texto que o agente segue é montado a partir das respostas.
4. **Prévia**: confira o que será criado e clique em **Criar agente**.

O agente é criado já ativo. A base de conhecimento e as ações são aplicadas em segundo plano, e o status aparece na tela.

Há um limite de agentes por portal. Ao atingi-lo, remova um agente para criar outro.

## Formulário, publicação e versões

Na aba **Função** do agente você altera as respostas do formulário.

- **Salvar rascunho** guarda as respostas sem mudar o agente.
- **Ver prévia e publicar** mostra o que muda (texto, configurações, base e ações). O agente só muda quando você publica.
- Se a publicação falhar, a tela mostra o motivo e o botão **Tentar de novo**.
- Quando há uma versão nova da função, a tela avisa. Ela só entra no agente quando você publica; pode pedir respostas novas.
- Pontos de atenção não impedem a publicação, mas o agente atende melhor com eles resolvidos.
- O texto do agente tem um limite de caracteres. Se passar, resuma as respostas mais longas.

### Modos

- **Simples** (padrão): tudo pelo formulário.
- **Avançado**: libera **Instruções adicionais**, que entram no fim do texto do agente, e treinamento por site e vídeo. Instruções mal escritas podem piorar o atendimento. Ao voltar ao modo simples e publicar, as instruções e os treinamentos por site e vídeo são removidos.
- **Controle assumido**: disponível só para alguns portais parceiros. O texto do agente passa a ser editado livremente e ele deixa de receber as melhorias da função. Ao voltar ao formulário, as edições do texto são perdidas.

### Ajuda e revisão por IA

No formulário, **Ajuda da IA** escreve um rascunho dos campos vazios a partir do que você contar; nada é gravado até você aplicar. Trechos `[preencher: …]` precisam ser completados antes de publicar.

A **Revisão por IA** aponta textos ambíguos, contradições e lacunas na base. Ela consome créditos, a não ser que um administrador cadastre uma chave própria em **Avançado → Chave Vibecode** (crie a chave só com o escopo `vibe:ai`). O texto da função e da base é enviado ao Vibecode do Bitrix24.

## Base de conhecimento e treinamentos

Treinar não consome créditos.

- Os itens da base são preenchidos no formulário, na aba **Função**. Use um assunto por item; cada item vira um treinamento, marcado como "da função". Para alterá-lo, mude o item no formulário e publique.
- Na aba **Treinamentos**, **Adicionar treinamento** acrescenta um **Texto**, com imagem se quiser. **Site** e **Vídeo** só no modo avançado.
- Sites podem ser lidos com as páginas ligadas e atualizados em intervalos.
- Em **Tags e prazo** você organiza o treinamento e define quando ele expira; vencido, ele é retirado do agente. Treinamentos da função aceitam só tags.
- **Exportar** e **Importar** levam os treinamentos manuais de um agente para outro. A importação soma aos existentes; importar o mesmo arquivo duas vezes duplica os itens.
- Status: **Processando**, **Pronto**, **Falhou** (use **Reenviar**) e **Expirado**.
- O plano limita a quantidade de treinamentos.

Escreva textos claros e completos, com prazos, condições e exceções. Quanto mais claro o conteúdo, melhores as respostas.

## Configurações do agente

Na aba **Configurações**:

- **Identidade** e **Modelo de IA**. Cada resposta consome créditos conforme o modelo escolhido; os modelos disponíveis dependem do plano.
- **Atendimento**: juntar mensagens seguidas do cliente, fuso horário, limite de mensagens por contato no dia (e o que fazer ao atingir), lembrar o cliente, dividir respostas longas e assinar as mensagens. Transferência, emojis e assuntos vêm da função (aba **Função**).
- **Horário de funcionamento**.

Clique em **Salvar alterações**.

## Testar o agente

O botão **Testar**, na tela do agente, abre conversas de teste. Escreva como se fosse o cliente. Cada resposta consome créditos como uma conversa real. Gatilhos não são disparados e ações no CRM são apenas simuladas. Com o **Acesso ao CRM** ligado, dá para simular um contato, lead ou empresa. O teste funciona fora do horário de funcionamento; o agente precisa estar ativo.

## O agente respondeu errado

1. Veja se a informação certa está na base. Se faltar, acrescente um item.
2. Procure textos que se contradizem entre o formulário e os treinamentos.
3. Use **Analisar alucinação**, quando disponível: escolha uma conversa, marque a resposta errada e a IA confere o que foi dito com a base e sugere a correção.
4. Publique e teste de novo.

## Intenções

Na aba **Intenções**, o agente executa ações durante a conversa: registrar lead, negócio ou tarefa no Bitrix24, transferir para um atendente ou consultar um sistema seu por API.

**Nova intenção** tem quatro passos: **Intenção** (nome e **Quando usar**), **Informações** (o que perguntar ao cliente), **Ação** (no Bitrix24 ou chamar uma API) e **Resposta**.

- Em **Quando usar**, descreva a situação do cliente, não a ação. É o que o agente lê para decidir.
- A intenção precisa estar **Ativa**. O **Histórico** mostra quando foi usada e o resultado.
- Intenções marcadas como "da função" são alteradas pelo formulário da função.

## Gatilhos

Na aba **Gatilhos**, ações automáticas no Bitrix24 acontecem quando há um evento no atendimento, como primeiro atendimento do cliente, nova mensagem, fim de atendimento ou transferência para humano. Ações possíveis: criar lead, criar ou atualizar negócio, comentar na timeline, criar tarefa, iniciar processo de negócio, criar item de processo inteligente, transferir para atendente e chamar uma URL externa.

Gatilho é disparado por um evento; intenção é usada quando o agente decide, pela conversa. O **Histórico** do gatilho mostra cada execução e as falhas.

## Colocar o agente para atender

1. No Bitrix24, abra o **Contact Center** e entre em **Canais abertos**.
2. Abra o canal que vai usar.
3. Nas configurações do canal, em **Chatbot**, selecione o agente.
4. Salve. As próximas conversas do canal passam a ser atendidas pelo agente.

Se o agente não responder, confira: o agente está **Ativo**; ele está selecionado no canal; há saldo de créditos; a mensagem chegou dentro do horário de funcionamento; nenhum atendente está atendendo a conversa.

## Transferência para humano

A transferência vem das regras da função do agente, de uma intenção ou de um gatilho. A conversa vai para um operador do canal aberto (ou para o destino configurado) e o agente deixa de responder nela. Ele volta a responder depois que o atendente encerra o atendimento. Configure a fila e o expediente da Linha Aberta no Bitrix24.

## Horário de funcionamento e fora do horário

Em **Configurações → Horário de funcionamento**, defina o fuso e os intervalos de cada dia. Sem horário, o agente responde 24 horas.

Fora do horário o agente não responde e não consome créditos:

- Com **Transferir para um atendente** ligado (é o padrão), a conversa vai para um operador e o agente só volta quando o atendente a encerra. A mensagem fora do horário, se preenchida, é enviada antes.
- Com a opção desligada, a mensagem fora do horário (se preenchida) é enviada no máximo uma vez a cada 12 horas. Mensagens recebidas fora do horário não são respondidas depois.

## CRM e agenda

- **Acesso ao CRM** (na tela do agente): o agente consulta o cliente da conversa e os negócios dele. Ele só lê.
- **Avançado → CRM para o agente**: escolha os campos que o agente pode ler e descreva o que cada um significa. Só os campos adicionados chegam a ele. Adicione telefone e e-mail apenas se forem necessários.
- **Agenda**: com ela, o agente consulta horários livres no Calendário do Bitrix24 e marca compromissos. Exige o acesso ao CRM ligado. Define de quem é a agenda, a duração, a antecedência mínima e até quantos dias à frente procurar. Segue o horário de funcionamento do agente; sem ele, segunda a sexta, das 09:00 às 18:00 (horário de Brasília). Se o Bitrix24 recusar o Calendário, um administrador precisa reinstalar o aplicativo.

## Créditos e plano

Em **Créditos e plano** ficam o saldo, o consumo por dia e por agente, as movimentações, os planos e os créditos adicionais.

- Cada resposta do agente consome créditos conforme o modelo de IA.
- Há um teste grátis, ativado por um administrador, quando disponível.
- Sem créditos, as novas mensagens são transferidas para os atendentes até haver saldo.
- Os créditos do plano e os adicionais valem até o fim do ciclo da assinatura.
- Pacotes adicionais exigem um plano ativo.
- Subir de plano vale na hora, com cobrança proporcional; descer vale na próxima renovação.
- Com pagamento recusado, atualize o cartão em **Gerenciar pagamento** antes do prazo mostrado, para os agentes não serem pausados.
- Assinaturas contratadas direto com a CRMThink são alteradas com o time comercial.

Preços e quantidades de créditos aparecem na própria tela.

## Avisos

Em **Avisos**, um administrador escolhe quem recebe no Bitrix24 as notificações de créditos e pagamento. Sem ninguém escolhido, vão para os administradores. **Enviar aviso de teste** confirma que chegam.

## Quando falar com o suporte

Fale com o suporte quando o app disser que o agente está "fora de sincronia" ou não foi encontrado, quando a conta estiver suspensa, em problemas de cobrança ou quando um erro continuar depois de tentar de novo.
