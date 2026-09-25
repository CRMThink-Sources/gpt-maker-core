## Aplicação para bitrix24, para criação de agentes de IA no gptmaker integrados ao bitrix

## Overview

- Temos uma conta PARTNER no gptmaker, onde temos creditos ilimitados e a criação de agentes tambem é ilimitada
- Iremos criar uma aplicação integrada ao gptmaker, onde o cliente podera criar/inativar agentes
- O cliente deve poder configurar o agente dele, realizar treinamento. Isso tudo refletindo no agente criado no gptmaker
- No agente do gptmaker, é possivel criar gatilhos, esses podem ser configurados para disparar webhooks
- Como temos creditos ilimitados, ao final do periodo pagamos pelo consumo de creditos
- Iremos ofertar planos aos clientes, com quantidade de creditos, e para cada resposta do gptmaker, iremos deduzir do saldo dele

## Frameworks a ser utilizado

- TypeScript (backend NestJS, Node 24 LTS)
- NextJS
- Fila de processamento - A definir stack
- Cache - A definir stack
- Docker
- CI/CD
- Postgresql
