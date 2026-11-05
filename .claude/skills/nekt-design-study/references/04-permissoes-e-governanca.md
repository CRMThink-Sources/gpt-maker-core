# Permissões e governança para agentes no Nekt

## Princípio central

**Fato (docs):** o agente nunca enxerga mais do que a pessoa por trás do token. O teto é sempre o criador do token.

## Dois tipos de token

| | Token de acesso completo | Token escopado |
|---|---|---|
| Visibilidade | Tudo que o criador acessa | Só o que foi selecionado, por tipo de recurso (tabelas, volumes, segredos, documentos de contexto, conexões ao vivo) **e por ferramenta** |
| Reação a mudanças de permissão do criador | Acompanha nos dois sentidos | **Só estreita**: perde o que o criador perde; não ganha o que o criador ganha |
| O que nunca alcança | O que o criador não alcança | Fontes, destinos, Queries/Notebooks, gatilhos, execuções, GitHub, gestão de permissões e de tokens, log de acesso |
| Uso típico | Pessoa conectando seu próprio agente | Automações e integrações com escopo estreito e estável |

**Fato (docs):** tokens criados via OAuth são de acesso completo e vinculados ao usuário que autenticou.

**Fato (docs):** um token escopado **não é somente leitura** por padrão. Se as ferramentas não forem restringidas, ele pode usar ferramentas de escrita que se aplicam ao seu escopo. Para ser só leitura, é preciso selecionar só ferramentas de leitura.

**Fato (docs):** token dura no máximo um ano. Se o criador é desativado ou removido, **o token para de funcionar**, qualquer que seja o escopo. A documentação recomenda criar tokens substitutos antes de alguém sair.

**Fato (docs):** a criação de tokens por agente tem salvaguardas: só um token completo pode criar tokens (um token escopado nunca se amplia nem cria um mais amplo), a criação é em duas fases, e o segredo **nunca** volta no resultado — vem um link de uso único, válido por 15 minutos, que só abre na sessão do navegador do criador.

## Permissões herdadas e "a maior vence"

**Fato (docs):** o Nekt aplica sempre a **maior** permissão que o usuário tem por qualquer grupo ou atribuição direta. Revogar acesso de um grupo não remove o acesso se outro grupo (inclusive o grupo embutido "All") ainda concede.

**Fato (docs):** os níveis são Viewer, Editor e Manager. Na camada de contexto: ler exige acesso à pasta, editar exige Editor e apagar exige Manager. Quem tem Manager num recurso pode conceder Viewer/Editor ali; só Owners e Admins criam ou removem Manager.

**Fato (docs):** revogar uma permissão também remove o recurso de qualquer token escopado que dependia dela, e conceder de novo **não** devolve ao token. Por isso a documentação recomenda alterar o nível em vez de revogar e conceder de novo.

## O resultado vazio ambíguo

**Fato (docs):** um `get_semantic_context` vazio pode significar duas coisas: a pergunta não bateu com nenhum documento, **ou** existe documentação que o usuário não pode ler. Reformular resolve o primeiro caso e nunca resolve o segundo. Por isso o agente é orientado a reformular em subperguntas mais estreitas no primeiro caso e, no segundo, avisar que pode haver documentação sem acesso — em vez de insistir.

**Leitura de design:** o Nekt pensa no comportamento do agente diante de permissões, não só na regra de acesso. Um "não encontrei" honesto vale mais que um agente em loop.

## Auditoria por ferramenta

**Fato (docs):** toda requisição feita com chave de API ou token MCP vai para um log de acesso: qual token, quem criou, qual ação, qual endpoint, o status e o conteúdo da requisição (incluindo o SQL de cada consulta, com credenciais mascaradas).

**Fato (docs):** cada ferramenta chamada por um token MCP vira **uma entrada própria, com o nome da ferramenta** — inclusive as que nunca chegam à API (como `generate_sql`, `get_semantic_context` e as ferramentas ao vivo) e as chamadas recusadas pelo escopo.

**Fato (docs):** retenção por plano (7, 30 ou 90 dias), exportação do período em Parquet com custo das consultas, e visibilidade: Owners e Admins veem todos os tokens; os demais, só os que criaram.

**Leitura de design:** auditar *a intenção do agente* (qual ferramenta, com quais argumentos) e não só o efeito no banco é o que permite responder "por que o agente fez isso?".

## Diferença por plano

**Fato (docs):** permissões em nível de dado e de pasta de contexto só são aplicadas nos planos Growth e Custom. Em Starter/Free, todos os membros acessam tudo e o escopo de token funciona "tudo ou nada" por tipo de recurso.

**Leitura de design:** a governança granular é um diferencial de plano, mas o *modelo* (token, escopo, log) existe em todos.

## Fontes

- https://docs.nekt.com/mcp-server/permissions.md
- https://docs.nekt.com/mcp-server/tools.md (seções "Managing permissions", "Managing MCP tokens", "Token access log")
