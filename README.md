# AV3 - GreenCode

> Do descarte ao destino: cada equipamento rastreado.

Plataforma de **logística reversa de equipamentos eletrônicos**, desenvolvida em Node.js e TypeScript com Fastify, Prisma ORM, PostgreSQL, BullMQ e Redis.

O greencode acompanha o caminho de equipamentos descartados por organizações clientes: do contrato com a organização, passando pela chegada dos lotes e pela triagem de cada equipamento, até o destino final (reaproveitamento de peças, reciclagem, descarte seguro) e a baixa definitiva. Cada equipamento recebe do sistema um código de barras interno (ex.: `GC-2026-000123`) e pode ser rastreado do começo ao fim.

**Evolução:** a [AV1](https://github.com/pamelaiwabuchi/AV1) era uma aplicação de linha de comando com arquivos criptografados; a [AV2](https://github.com/pamelaiwabuchi/AV2), um servidor monolítico com API RESTful para os funcionários. A **AV3** transforma o sistema numa plataforma com dois pilares novos:

1. **Camada analítica:** relatórios de eficiência operacional, rentabilidade por tipo de equipamento e previsão de vida útil (regressão linear), guardados no banco para consulta histórica e gerados também automaticamente todo mês.
2. **API pública para parceiros:** as organizações clientes integram o sistema delas ao greencode com uma **chave de API**: avisam envios de lotes, rastreiam equipamentos, baixam certificados e pedem relatórios pesados, processados em **fila** (BullMQ + Redis), com aviso por **webhook** assinado.

As justificativas das decisões técnicas estão no **[Relatório Técnico](RELATORIO_TECNICO.md)**.

---

## Início rápido

Precisa só do [Docker](https://www.docker.com/) instalado. Os comandos são os mesmos no Linux e no Windows:

```bash
git clone https://github.com/pamelaiwabuchi/AV3.git
cd AV3
docker compose up -d --build
```

1. Abra <http://localhost:3333/docs>.
2. **Como funcionário:** em `POST /api/v1/internal/auth/login`, entre com `{ "login": "admin", "senha": "Greencode1" }`. Clique em **Authorize**, cole o token no campo **token** e troque a senha em `PATCH /api/v1/internal/auth/senha` (a do seed é provisória). Use o token novo no **Authorize**.
3. **Como parceiro (API pública):** clique em **Authorize** e cole no campo **chaveApi** a chave de exemplo da TechCorp:
   `gc_exemplo0techcorp0000000000000000000000000000000000000000000000`
   Depois abra o grupo **"API pública (parceiros)"**. Os exemplos já vêm preenchidos.
4. O [roteiro rápido de teste](#roteiro-rápido-de-teste-uns-10-minutos) mostra o que experimentar.

Para desligar: `docker compose down`. Para instalar sem Docker, veja a [seção 2](#2-instalação).

---

## Sumário

1. [Requisitos](#1-requisitos)
2. [Instalação (Linux e Windows)](#2-instalação)
3. [Como usar](#3-como-usar)
4. [API pública (parceiros)](#4-api-pública-parceiros)
5. [Camada analítica](#5-camada-analítica)
6. [Usuários e permissões](#6-usuários-e-permissões)
7. [Rotas internas](#7-rotas-internas)
8. [Arquitetura](#8-arquitetura)
9. [Regras de negócio](#9-regras-de-negócio)
10. [Decisões e justificativas](#10-decisões-e-justificativas)
11. [Testes](#11-testes)
12. [Limitações conhecidas e melhorias futuras](#12-limitações-conhecidas-e-melhorias-futuras)

---

## 1. Requisitos

- **Git**
- **Com Docker:** só o Docker (no Windows, o Docker Desktop).
- **Sem Docker:** **Node.js 22 ou mais novo** (confira com `node --version`), **PostgreSQL 14 ou mais novo** e **Redis 7 ou mais novo**. No Windows, o Redis não tem versão oficial: use o Docker só para ele (`docker compose up -d redis`).

Funciona em **Windows 10 ou superior** e **Ubuntu 24.04 ou superior** (e derivados). Desenvolvido no Arch Linux.

---

## 2. Instalação

Há dois jeitos: com Docker (2.1), que sobe o banco, o Redis e a API com um comando, ou instalando tudo no sistema (2.2 a 2.5).

### 2.1 Com Docker

```bash
git clone https://github.com/pamelaiwabuchi/AV3.git
cd AV3
docker compose up -d --build
```

Os comandos são os mesmos no Linux e no Windows. O `.env` é opcional: sem ele, o `docker-compose.yml` usa valores padrão (administrador `admin` com a senha provisória `Greencode1`). Para usar outros valores, crie o `.env` como na [seção 2.3](#23-baixar-e-configurar-o-projeto); o `DATABASE_URL` e o `REDIS_URL` dele são ignorados, porque o Compose aponta a API para os serviços do Docker.

> Em produção, defina um `JWT_SECRET` próprio no `.env`. O padrão do Compose serve só para testes.

O `docker compose up` cria três contêineres:

- **banco**: PostgreSQL 18, sem porta aberta para fora (só a API fala com ele). Os dados ficam no volume `dados-banco`.
- **redis**: Redis 7, a fila de tarefas. A porta 6379 fica aberta só no próprio computador (`127.0.0.1`), para o `npm run dev` poder usar. As tarefas ficam no volume `dados-fila` e sobrevivem a reinícios.
- **api**: montada pelo `Dockerfile`. Só liga quando o banco e o Redis respondem (healthcheck). Ao ligar, aplica as migrações, roda o seed (que não duplica dados) e sobe o servidor na porta 3333, já com os workers da fila.

Para conferir: <http://localhost:3333/health>.

| Comando | O que faz |
|---|---|
| `docker compose logs -f api` | Mostra o log da API |
| `docker compose down` | Desliga (mantém os dados) |
| `docker compose down -v` | Desliga e **apaga** o banco e a fila do Docker |
| `docker compose up -d redis` | Sobe **só o Redis** (para usar com o `npm run dev`) |

> Não rode a API do Docker e o `npm run dev` ao mesmo tempo: os dois usam a porta 3333.

### 2.2 Instalar o PostgreSQL e o Redis

**Ubuntu:**

```bash
sudo apt update
sudo apt install postgresql redis-server
sudo -u postgres psql -c "CREATE ROLE greencode WITH LOGIN PASSWORD 'greencode' CREATEDB;"
sudo -u postgres createdb -O greencode greencode
```

**Windows:**

1. Baixe e instale o PostgreSQL em <https://www.postgresql.org/download/windows/> (guarde a senha do usuário `postgres` que o instalador pedir).
2. Abra o **SQL Shell (psql)**, que vem com o instalador, entre como `postgres` e rode:

```sql
CREATE ROLE greencode WITH LOGIN PASSWORD 'greencode' CREATEDB;
CREATE DATABASE greencode OWNER greencode;
```

3. Para o Redis, com o Docker Desktop instalado, rode na pasta do projeto: `docker compose up -d redis`.

> O `CREATEDB` só é necessário para quem for desenvolver (`npx prisma migrate dev`), porque esse comando cria um banco temporário para conferir as migrações.

### 2.3 Baixar e configurar o projeto

```bash
git clone https://github.com/pamelaiwabuchi/AV3.git
cd AV3
npm install
```

Crie o `.env` a partir do `.env.example` (funciona em qualquer sistema e não sobrescreve um `.env` que já exista):

```bash
npm run configurar
```

Abra o `.env` e preencha:

| Variável | O que é | Exemplo |
|---|---|---|
| `DATABASE_URL` | Endereço do banco | `postgresql://greencode:greencode@localhost:5432/greencode` |
| `PORT` | Porta do servidor | `3333` |
| `JWT_SECRET` | Texto secreto usado para assinar os tokens. Use um texto longo e aleatório | (veja abaixo) |
| `ADMIN_LOGIN` | Login do primeiro administrador, criado pelo seed | `admin` |
| `ADMIN_SENHA` | Senha provisória do primeiro administrador | `Greencode1` |
| `EMPRESA_RAZAO_SOCIAL` | Nome da empresa que emite os certificados de destinação | `GreenCode Logística Reversa Ltda` |
| `EMPRESA_CNPJ` | CNPJ da empresa emissora (precisa ser válido) | `47.638.125/0001-05` |
| `REDIS_URL` | Endereço do Redis (fila de tarefas) | `redis://localhost:6379` |
| `LIMITE_API_POR_MINUTO` | Limite padrão de requisições por minuto de uma chave de API nova | `100` |
| `INICIAR_WORKERS` | (opcional) `false` para o servidor não processar a fila (os workers rodam em outro processo: `npm run worker`) | `true` |

Para gerar um `JWT_SECRET` aleatório:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2.4 Criar as tabelas e os dados iniciais

```bash
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
```

- `migrate deploy` cria as tabelas, o trigger de auditoria e as proteções do banco.
- `generate` gera o Prisma Client (o código TypeScript de acesso ao banco), em `src/generated/prisma`.
- `db seed` cria o administrador, os parâmetros globais, a conta de serviço da API pública, a chave de API de exemplo e uma **massa de dados de exemplo**, incluindo **1 ano de histórico** para os relatórios (ver [seção 6](#6-usuários-e-permissões)).

### 2.5 Rodar

```bash
npm run dev
```

O servidor sobe na porta do `.env`, já com os workers da fila. Para conferir: <http://localhost:3333/health>. Sem o Redis, a API funciona, mas os relatórios pedidos pela API pública respondem 503 e o agendamento mensal não roda.

**Em produção:**

```bash
npm run build
npm start
```

**Worker separado (opcional, para escalar):** com `INICIAR_WORKERS=false` no servidor, rode quantos workers quiser em outros processos ou máquinas (`npm run worker`, ou `npm run worker:prod` depois do build). A fila divide as tarefas entre eles.

Para desligar, use **Ctrl+C**: o servidor para de aceitar requisições, espera as que estão em andamento terminarem, fecha os workers (a tarefa em andamento termina antes) e fecha as conexões com o banco e o Redis (graceful shutdown).

---

## 3. Como usar

A documentação interativa (Swagger) fica em **<http://localhost:3333/docs>**. Lá dá para ver e testar todas as rotas, com exemplos de requisição e de resposta, os códigos de erro e a descrição de cada parâmetro.

A API tem dois grupos de rotas, com políticas de segurança diferentes:

| Grupo | Prefixo | Quem usa | Autenticação |
|---|---|---|---|
| Interna | `/api/v1/internal` | Funcionários da greencode | Login com token JWT (30 minutos) e papel do usuário |
| Pública | `/api/v1/public` | Sistemas das organizações parceiras | Chave de API (`x-api-key`), permissões da chave e limite de requisições por minuto |

`/health` e `/docs` ficam fora dos dois grupos.

### Primeiro acesso (rotas internas)

1. Faça login em `POST /api/v1/internal/auth/login`:

```json
{ "login": "admin", "senha": "Greencode1" }
```

2. A resposta traz um **token** e o aviso `"precisaTrocarSenha": true`. Toda senha criada pelo administrador (inclusive a do seed) é provisória: até ser trocada, as outras rotas respondem **403**.
3. Clique em **Authorize** no Swagger, cole o token no campo **token** e clique em **Authorize** e **Close**.
4. Troque a senha em `PATCH /api/v1/internal/auth/senha`:

```json
{ "senhaAtual": "Greencode1", "novaSenha": "Admin2026" }
```

A nova senha precisa ter 8 caracteres, 1 maiúscula e 1 número. A resposta traz um **token novo**.
5. Clique em **Authorize** de novo, depois em **Logout**, cole o token novo e clique em **Authorize**.

Fora do Swagger, o token vai no cabeçalho `Authorization: Bearer <token>`.

### Erros

Todo erro responde no mesmo formato: `{ "erro": "mensagem em português" }`, com o código HTTP correspondente:

| Código | Significado |
|---|---|
| 400 | Dados no formato errado (campo faltando, tipo errado, id que não é UUID). A mensagem diz qual campo |
| 401 | Sem login, token inválido/expirado, senha errada, conta bloqueada; na API pública, chave ausente, inválida, revogada ou expirada |
| 403 | Autenticado, mas sem permissão (papel do usuário ou permissão da chave) |
| 404 | Não encontrado. Na API pública, também quando o registro é de outra organização |
| 409 | Conflito: valor único repetido (CNPJ, login, nota fiscal) ou registro alterado por outra pessoa (versão desatualizada); relatório ainda não pronto para download |
| 422 | Regra de negócio violada (ex.: cancelar um lote que já entrou em triagem) |
| 429 | Limite de requisições por minuto da chave atingido (o cabeçalho `retry-after` diz quantos segundos esperar) |
| 503 | Fila de processamento fora do ar (Redis desligado) |

**Editar e a `versao`.** Todo registro editável tem o campo `versao`. Para editar, consulte o registro antes e mande a `versao` junto no PATCH. Se outra pessoa tiver alterado o registro nesse meio-tempo, a resposta é **409**.

**Listagens.** Respondem `{ "itens": [ ... ], "pagina": 1, "totalPaginas": 3, "total": 47 }`.

**Versão.** Toda resposta traz o cabeçalho `api-version` (ex.: `1.0.0`, versionamento semântico). Mudanças que quebrem integrações vão para `/api/v2`, e a v1 continua por pelo menos 6 meses avisando a desativação pelos cabeçalhos `Deprecation` e `Sunset`.

### Roteiro rápido de teste (uns 10 minutos)

Usa os dados do seed. As rotas internas começam com `/api/v1/internal` e as públicas com `/api/v1/public` (abaixo aparecem sem o prefixo, para encurtar).

**Funcionários (faça o primeiro acesso acima, com o `admin`):**

1. **Painel:** `GET /painel` mostra os números gerais.
2. **Lote avisado pelo parceiro:** `GET /lotes?status=AGUARDANDO_RECEBIMENTO` mostra o lote `NF-1003`, que a TechCorp avisou pela API. Abra-o e anote a `versao`; confirme a chegada em `PATCH /lotes/{id}/confirmar-recebimento` com `{ "versao": <a anotada> }`. O lote passa a `RECEBIDO`, com a data de hoje.
3. **Movimentar pelo código de barras:** consulte `GET /equipamentos/codigo/GC-2026-000007`, anote a `versao` e mova com `POST /equipamentos/codigo/GC-2026-000007/movimentar` e `{ "novoStatus": "EM_TRIAGEM", "versao": <a anotada> }`. Repita com a mesma versão: **409**.
4. **Registrar uma falha:** com o `id` do equipamento do passo 3, `POST /equipamentos/{id}/falhas` com `{ "tipo": "BATERIA_VICIADA", "gravidade": "MODERADA" }`.
5. **Relatório de vida útil:** `POST /relatorios/analiticos` com `{ "tipo": "VIDA_UTIL" }`. A resposta mostra, por tipo de equipamento, a vida útil prevista, a vida contábil e o R². `GET /relatorios/analiticos` mostra o histórico; `GET /relatorios/analiticos/{id}/download?formato=csv` baixa a tabela para o Excel.
6. **Rentabilidade:** `POST /relatorios/analiticos` com `{ "tipo": "RENTABILIDADE" }`: valor médio de recuperação por tipo, estado físico, marca e modelo.
7. **Chave de API:** `POST /organizacoes/{id}/chaves-api` (o id da TechCorp já vem preenchido) gera uma chave nova; ela aparece **só nesta resposta**. A chave anterior continua valendo por 24 horas.
8. **Permissão:** faça login como `bruno.gestor` (senha `Greencode1`), troque a senha e use o token novo. `POST /relatorios/analiticos` com `RENTABILIDADE` responde **403**: é um relatório financeiro, só para o AUDITOR.

**Parceiro (Authorize → campo chaveApi → chave de exemplo):**

9. **Quem sou eu:** `GET /conta` mostra a organização (TechCorp) e as permissões da chave.
10. **Rastreabilidade:** `GET /equipamentos/GC-2026-000001` mostra o histórico e o laudo de falhas, sem o nome do funcionário e sem o valor de recuperação.
11. **Avisar um envio:** `POST /lotes` (exemplo pronto). O lote nasce `AGUARDANDO_RECEBIMENTO`. Envie de novo com a mesma nota fiscal: **409**.
12. **Relatório pesado em fila:** `POST /relatorios` (exemplo pronto: previsão de vida útil do inventário). A resposta é **202** com o id. Consulte `GET /relatorios/{id}` até o status ficar `CONCLUIDO` e baixe com `GET /relatorios/{id}/download?formato=csv`.
13. **Outra organização:** `GET /lotes/{id}` com o id de um lote da Escola Futuro Verde responde **404**.

---

## 4. API pública (parceiros)

A API pública permite que o sistema de uma organização cliente converse direto com o greencode, sem depender de um funcionário. O parceiro só vê e altera os **dados da própria organização**.

### Autenticação: chave de API

- Cada organização tem **uma chave oficial**, gerada por um funcionário (OPERADOR_CADASTRO ou ADMINISTRADOR) em `POST /api/v1/internal/organizacoes/{id}/chaves-api`. A chave tem o formato `gc_` + 64 caracteres e aparece **uma vez só**, na resposta da geração. O banco guarda só o **hash SHA-256** dela, e a listagem mostra só o prefixo (ex.: `gc_8f3a`).
- A chave vai em toda requisição, no cabeçalho `x-api-key`.
- **Troca planejada:** ao gerar uma chave nova, a anterior continua valendo por **24 horas**, para o parceiro atualizar o sistema dele sem ficar fora do ar. **Suspeita de vazamento:** com `revogarAnteriorNaHora: true`, a anterior para na hora. Uma chave também pode ser revogada a qualquer momento (`POST /api/v1/internal/chaves-api/{id}/revogar`).
- Organização desativada: a chave para de funcionar (e volta se a organização for reativada).
- Tudo que o parceiro grava fica registrado em nome da **conta de serviço** `api.parceiros` (um usuário que não faz login), na auditoria e nas movimentações; a observação da movimentação diz qual chave foi usada.

### Permissões (conforme o contrato comercial)

| Permissão | Libera |
|---|---|
| `LER_RASTREABILIDADE` | Consultar lotes, equipamentos (histórico e laudo de falhas), resumo e certificados |
| `GERENCIAR_LOTES` | Avisar envios de lotes, editar e cancelar enquanto não chegaram, adicionar, editar e remover equipamentos |
| `GERAR_RELATORIOS` | Pedir relatórios (eficiência dos próprios lotes e previsão de vida útil do inventário) |
| `ATUALIZAR_CADASTRO` | Alterar telefone, e-mail e endereço; cadastrar o webhook |

Chave sem a permissão da rota: **403**.

### Limite de requisições

Cada chave tem um **limite por minuto**, definido pelo operador ao gerar a chave (padrão: `LIMITE_API_POR_MINUTO`, 100). O limite é contado por organização (durante a troca, a chave antiga e a nova somam juntas). Toda resposta traz os cabeçalhos `x-ratelimit-limit`, `x-ratelimit-remaining` e `x-ratelimit-reset`; passou do limite, **429** com `retry-after`.

### Rotas (`/api/v1/public`)

| Rota | Permissão | O que faz |
|---|---|---|
| `GET /conta` | qualquer chave | Dados da organização, se tem contrato vigente e as permissões da chave |
| `PATCH /conta` | ATUALIZAR_CADASTRO | Altera telefone, e-mail ou endereço |
| `GET /lotes?pagina=&status=` | LER_RASTREABILIDADE | Lotes da organização |
| `GET /lotes/:id` | LER_RASTREABILIDADE | Um lote com os equipamentos |
| `POST /lotes` | GERENCIAR_LOTES | Avisa o envio de um lote (nasce `AGUARDANDO_RECEBIMENTO`) |
| `PATCH /lotes/:id` · `PATCH /lotes/:id/cancelar` | GERENCIAR_LOTES | Edita · cancela, só enquanto aguarda recebimento |
| `POST /lotes/:id/equipamentos` | GERENCIAR_LOTES | Adiciona equipamento, só enquanto aguarda recebimento |
| `PATCH /equipamentos/:codigo` · `PATCH /equipamentos/:codigo/cancelar` | GERENCIAR_LOTES | Edita · remove (cancela) equipamento, só enquanto o lote aguarda recebimento |
| `GET /equipamentos/:codigo` | LER_RASTREABILIDADE | Rastreabilidade: situação, histórico e laudo de falhas |
| `GET /lotes/:id/certificado` · `GET /certificado?inicio=&fim=` | LER_RASTREABILIDADE | Certificado de destinação em PDF (de um lote ou do período) |
| `GET /resumo?inicio=&fim=` | LER_RASTREABILIDADE | Lotes por status e kg por destinação |
| `POST /relatorios` | GERAR_RELATORIOS | Pede um relatório; responde **202** com o id (processado na fila) |
| `GET /relatorios` · `GET /relatorios/:id` | GERAR_RELATORIOS | Pedidos e status; com `CONCLUIDO`, traz o resultado |
| `GET /relatorios/:id/download?formato=json\|csv` | GERAR_RELATORIOS | Baixa o relatório pronto |
| `GET /webhook` · `PUT /webhook` · `DELETE /webhook` | ATUALIZAR_CADASTRO | Consulta, cadastra e remove o webhook |

### Relatório pesado: fila, status e webhook

O exemplo do enunciado: o parceiro pede a previsão de vida útil dos milhares de equipamentos que ainda usa. Em vez de deixar a conexão esperando:

1. `POST /relatorios` com `{ "tipo": "VIDA_UTIL_INVENTARIO", "itens": [ { "identificador": "PAT-0001", "tipo": "NOTEBOOK", "anoFabricacao": 2019 } ] }` (até 5000 itens).
2. A resposta vem **na hora**: `202 Accepted`, com o `id`, o status `PENDENTE`, o cabeçalho `Location` e os links de status e download.
3. Um **worker** pega a tarefa na fila (BullMQ + Redis), calcula e guarda o resultado.
4. O parceiro descobre que ficou pronto de dois jeitos:
   - **polling:** consulta `GET /relatorios/{id}` até o status ficar `CONCLUIDO` (ou `FALHOU`, com o erro);
   - **webhook:** se cadastrou um endereço em `PUT /webhook`, o greencode faz um `POST` nele quando o relatório termina.
5. Baixa em `GET /relatorios/{id}/download?formato=csv` (abre no Excel) ou `formato=json` (completo).

**Tentativas:** um erro passageiro (banco ou rede) é tentado de novo até 3 vezes (espera de 1 e 2 minutos); erro nos dados enviados falha na hora, porque daria o mesmo erro. Avisos de webhook são tentados até 5 vezes (30 s, 1, 2 e 4 minutos).

**Conferindo o webhook.** O aviso é um JSON (`evento`, `relatorioId`, `status`, `links`...) com o cabeçalho `x-greencode-assinatura: sha256=<hmac>`. O segredo aparece uma vez, na resposta do `PUT /webhook`. Do lado do parceiro, por exemplo em Node.js:

```js
const crypto = require("node:crypto");

function avisoVerdadeiro(corpoRecebido, cabecalhoAssinatura, segredo) {
    const esperado = "sha256=" + crypto.createHmac("sha256", segredo).update(corpoRecebido).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(cabecalhoAssinatura));
}
```

O endereço do webhook precisa ser `https://`.

---

## 5. Camada analítica

Três relatórios, organizados como serviços independentes em `src/services/analise/`. Eles são acessados pela API interna (na hora), pela API pública (em fila) e por **agendamento automático**: todo dia 1º, às 3h (horário de Brasília), o sistema gera a eficiência e a rentabilidade do mês anterior e recalcula a previsão de vida útil.

Todo relatório gerado fica guardado na tabela `RelatorioGerado` (parâmetros, quem pediu, quando, status e resultado em JSON), e as previsões de vida útil também ficam em colunas na tabela `PrevisaoVidaUtil`, para comparar as previsões com o que acontecer depois. As contas usam a biblioteca **simple-statistics**.

| Relatório | Pergunta que responde | Conteúdo |
|---|---|---|
| **Eficiência operacional** (`EFICIENCIA`) | Quanto tempo um lote leva da entrada até o fim da triagem, onde trava, quem é mais rápido, quais meses são mais lentos? | Média, mediana, desvio padrão e percentil 90 dos dias; tempo em cada etapa e o **gargalo** (etapa interna mais lenta); comparação entre **operadores** e entre **meses** (variação em % sobre a média) |
| **Rentabilidade** (`RENTABILIDADE`) | Quanto rende cada equipamento? | Valor de recuperação total e médio por tipo, estado físico, destinação, tipo × estado, marca e modelo; modelo mais e menos rentável |
| **Vida útil remanescente** (`VIDA_UTIL`) | Com que idade cada tipo de equipamento fica inservível? | Regressão linear (mínimos quadrados) do **índice de desgaste** pela idade, por tipo: coeficientes, R² e nível de confiança, vida útil prevista e comparação com a **vida útil contábil** (100% ÷ taxa de depreciação dos parâmetros) |
| **Vida útil do inventário** (`VIDA_UTIL_INVENTARIO`, só pela API pública) | Quando os equipamentos que o parceiro ainda usa vão precisar ser trocados? | Para cada item: idade, anos restantes, ano previsto e situação; resumo de coletas previstas por ano |

**Índice de desgaste** = nível do estado físico avaliado na triagem (NOVO = 0 ... INSERVIVEL = 6) + pontos das falhas registradas (LEVE 0,5; MODERADA 1; GRAVE 2). A vida útil prevista é a idade em que a reta atinge o desgaste médio dos equipamentos que chegaram inservíveis. Tipos com menos de 5 equipamentos avaliados saem como "dados insuficientes".

**Histórico de exemplo.** Para os relatórios terem o que analisar, o seed cria um ano de operação (42 lotes, cerca de 370 equipamentos, movimentações, falhas e valores), com números sorteados a partir de uma semente fixa: todo banco novo recebe exatamente os mesmos dados.

---

## 6. Usuários e permissões

### Dados de exemplo do seed

| Login | Papel | Departamento | Senha provisória |
|---|---|---|---|
| `admin` | ADMINISTRADOR | TI | a do `.env` (`ADMIN_SENHA`) |
| `ana.operadora` | OPERADOR_CADASTRO | Comercial | `Greencode1` |
| `bruno.gestor` | GESTOR_ALMOXARIFADO | Almoxarifado | `Greencode1` |
| `diego.gestor` | GESTOR_ALMOXARIFADO | Triagem | `Greencode1` |
| `elisa.gestor` | GESTOR_ALMOXARIFADO | Triagem | `Greencode1` |
| `carla.auditora` | AUDITOR | Financeiro | `Greencode1` |
| `api.parceiros` | conta de serviço da API pública (desativada, não faz login) | TI | — |

O seed também cria 8 departamentos, 3 organizações (o Hospital Bem Estar sem contrato), contratos, 2 destinos parceiros, os lotes de exemplo da AV2 (finalizado, em triagem, parado há 35 dias e cancelado), o lote `NF-1003` aguardando recebimento, o histórico de 1 ano e a **chave de API de exemplo** da TechCorp, com as 4 permissões:

```
gc_exemplo0techcorp0000000000000000000000000000000000000000000000
```

> A chave de exemplo existe só para testes e demonstração, assim como a senha `Greencode1`. Numa instalação real, revogue-a.

### Permissões dos funcionários (princípio do menor privilégio)

O **ADMINISTRADOR** pode tudo. Os demais:

| Módulo | OPERADOR_CADASTRO | GESTOR_ALMOXARIFADO | AUDITOR |
|---|---|---|---|
| Usuários e departamentos | — | — | — |
| Organizações | tudo | só o resumo (ativas com contrato vigente) | consulta |
| Chaves de API | tudo (gerar, revogar) | — | consulta |
| Contratos | tudo | — | consulta |
| Destinos | tudo | consulta (só os ativos) | consulta |
| Lotes e equipamentos (inclui confirmar recebimento) | consulta | tudo | consulta |
| Falhas | consulta | tudo (registrar, anular) | consulta |
| Histórico (movimentações) | — | consulta | consulta |
| Relatório de destinação | sim | sim | sim |
| Relatório financeiro | — | — | sim |
| Relatório analítico de eficiência | — | sim | sim |
| Relatório analítico de rentabilidade | — | — | sim |
| Relatório analítico de vida útil | sim | sim | sim |
| Auditoria e parâmetros | — | — | consulta |

Todo usuário vê o próprio perfil, o próprio painel e troca a própria senha.

---

## 7. Rotas internas

Todas começam com **`/api/v1/internal`** (abaixo aparecem sem o prefixo). A lista completa, com os campos, exemplos e erros de cada rota, está no Swagger (`/docs`).

Nas listagens, os filtros de texto aceitam só um pedaço e não diferenciam maiúsculas (`organizacaoNome=tech` acha "TechCorp"). O CNPJ também aceita um pedaço, com ou sem pontuação. As edições usam **PATCH**: mande só os campos que quer mudar, junto com a `versao`.

**Autenticação**

| Rota | O que faz |
|---|---|
| `POST /auth/login` | Login; devolve o token |
| `PATCH /auth/senha` | Troca a própria senha (exige a atual) |
| `GET /auth/perfil` | Dados do usuário logado |

**Usuários e departamentos** (só administrador)

| Rota | O que faz |
|---|---|
| `GET /usuarios?pagina=1&busca=&papel=&departamentoId=&departamento=&ativo=&bloqueado=` | Lista, com busca por nome ou login e filtros |
| `GET /usuarios/:id` · `GET /usuarios/login/:login` | Mostra um (pelo id ou pelo login) |
| `POST /usuarios` · `PATCH /usuarios/:id` | Cria (senha provisória) · edita nome, papel, departamento, ativo |
| `PATCH /usuarios/:id/senha` | Redefine a senha e desbloqueia a conta |
| `GET /departamentos` · `GET /departamentos/:id` · `GET /departamentos/:id/usuarios` | Lista · mostra · funcionários ativos |
| `POST /departamentos` · `PATCH /departamentos/:id` | Cria · edita |

**Organizações, chaves de API, contratos e destinos**

| Rota | O que faz |
|---|---|
| `GET /organizacoes?pagina=1&busca=` · `GET /organizacoes/resumo` · `GET /organizacoes/:id` | Lista · resumo do gestor · mostra |
| `POST /organizacoes` · `PATCH /organizacoes/:id` | Cria · edita (desativar = `ativo: false`) |
| `GET /organizacoes/:id/chaves-api` | Chaves da organização (prefixo, permissões, limite, ativa, expiração; nunca a chave) |
| `POST /organizacoes/:id/chaves-api` | Gera a chave (`permissoes`, `limitePorMinuto`, `revogarAnteriorNaHora`); aparece só nesta resposta |
| `POST /chaves-api/:id/revogar` | Revoga uma chave na hora |
| `GET /contratos?...` · `GET /organizacoes/:id/contratos` · `GET /contratos/:id` | Lista com filtros · histórico da organização · mostra |
| `POST /contratos` · `PATCH /contratos/:id` · `DELETE /contratos/:id` | Cria · edita · apaga (só contrato futuro) |
| `PATCH /contratos/:id/renovar` · `PATCH /contratos/:id/encerrar` | Renova · encerra (só contrato vigente) |
| `GET /destinos` · `GET /destinos/:id` · `POST /destinos` · `PATCH /destinos/:id` | CRUD de destinos |

**Lotes, equipamentos e falhas**

| Rota | O que faz |
|---|---|
| `GET /lotes?pagina=1&status=&anoEntrada=&notaFiscal=&transportadora=&organizacaoId=&organizacaoNome=&organizacaoCnpj=` | Lista, com filtros |
| `GET /lotes/parados` | Lotes parados no mesmo status há mais dias que o configurado |
| `GET /lotes/:id` | Mostra um, com os equipamentos e o peso total |
| `POST /lotes` | Registra a chegada de um lote, já com os equipamentos |
| `PATCH /lotes/:id/confirmar-recebimento` | Confirma a chegada de um lote avisado pela API (`versao`, `dataEntrada` opcional) |
| `PATCH /lotes/:id` · `PATCH /lotes/:id/cancelar` | Edita · cancela (só antes da triagem) |
| `POST /lotes/:id/equipamentos` | Adiciona um equipamento |
| `GET /equipamentos?...` · `GET /equipamentos/codigo/:codigo` · `GET /equipamentos/:id` | Lista com filtros · busca pelo código · mostra (com depreciação) |
| `GET /equipamentos/:id/historico` | Linha do tempo das movimentações |
| `PATCH /equipamentos/:id` · `PATCH /equipamentos/:id/avaliacao` | Edita · avalia o estado físico |
| `POST /equipamentos/:id/movimentar` · `POST /equipamentos/codigo/:codigo/movimentar` | Muda o status (para peças ou reciclável: `destinoId` e `valorRecuperacao`) |
| `POST /equipamentos/movimentar-varios` | Muda vários de uma vez, pelos códigos, tudo ou nada |
| `POST /equipamentos/:id/corrigir` | Desfaz uma movimentação errada e as seguintes |
| `GET /equipamentos/:id/falhas` · `POST /equipamentos/:id/falhas` | Falhas do equipamento · registra uma falha (na triagem ou no desmonte) |
| `GET /falhas?pagina=&tipo=&gravidade=&tipoEquipamento=&inicio=&fim=&incluirAnuladas=` · `POST /falhas/:id/anular` | Lista com filtros · anula uma falha registrada por engano |
| `GET /movimentacoes?...` | Todas as movimentações, com filtros |

**Painel, relatórios, certificados, auditoria e parâmetros**

| Rota | O que faz |
|---|---|
| `GET /painel` | Números resumidos de cada papel |
| `GET /relatorios/destinacao?organizacaoId=&inicio=&fim=` · `GET /relatorios/financeiro?inicio=&fim=` | Relatórios da AV2 |
| `POST /relatorios/analiticos` | Gera e guarda um relatório analítico (`tipo`, `inicio`, `fim`, `organizacaoId`) |
| `GET /relatorios/analiticos?pagina=&tipo=&status=` · `GET /relatorios/analiticos/:id` | Histórico · um relatório com o resultado |
| `GET /relatorios/analiticos/:id/download?formato=json\|csv` | Baixa o relatório |
| `GET /lotes/:id/certificado` · `GET /organizacoes/:id/certificado?inicio=&fim=` | Certificado de destinação (PDF) |
| `GET /auditoria?...` | Registro de todas as alterações |
| `GET /parametros` · `PATCH /parametros` | Consulta · altera alíquota, depreciação e dias de lote parado |

As datas usam o formato `AAAA-MM-DD`.

---

## 8. Arquitetura

O código segue o padrão **Controller → Service → Repository**:

```
src/
├── server.ts          # sobe o servidor e os workers; graceful shutdown
├── worker.ts          # processo só de workers (npm run worker), para escalar
├── workers.ts         # workers da fila: relatórios, agendamento mensal e webhooks
├── app.ts             # Fastify: erros, JWT, Swagger, rotas internas e públicas, limite de requisições
├── controllers/       # HTTP: valida o formato (JSON Schema) e confere a permissão
├── services/          # regras de negócio
│   └── analise/       # camada analítica: eficiência, rentabilidade, vida útil
├── repositories/      # acesso ao banco, pelo Prisma Client
├── plugins/           # JWT e papéis (autenticacao.ts), chave de API (chaveApi.ts), Swagger
├── lib/               # banco (prisma.ts), transação auditada (transacao.ts), fila (fila.ts)
├── errors/            # classes de erro (ErroNaoEncontrado → 404, ErroConflito → 409...)
└── utils/             # CNPJ, datas, estatística, CSV, chave de API, prefixos e versão
prisma/
├── schema.prisma      # modelos do banco
├── migrations/        # migrações versionadas (inclui o SQL dos triggers)
├── seed.ts            # dados iniciais e de exemplo
└── seedHistorico.ts   # 1 ano de histórico de exemplo para os relatórios
tests/                 # testes automatizados
Dockerfile             # imagem da API
docker-compose.yml     # banco, Redis e API
```

O caminho de um relatório pedido pela API pública:

1. O plugin da chave (`onRequest`) confere a chave e a permissão; o limite de requisições (`preHandler`) confere a cota da organização; o JSON Schema confere o corpo.
2. O service grava o pedido (`RelatorioGerado`, `PENDENTE`) e coloca uma tarefa na fila; a resposta 202 sai na hora.
3. O worker pega a tarefa, chama o serviço de análise, guarda o resultado (`CONCLUIDO`) e coloca o aviso na fila de webhooks.
4. O worker de webhooks assina e entrega o aviso; o parceiro baixa o resultado.

### Modelos

`Usuario`, `Departamento`, `Organizacao`, `ChaveApi`, `Contrato`, `Destino`, `Lote`, `Equipamento`, `Movimentacao`, `Falha`, `Parametros`, `Auditoria`, `RelatorioGerado` e `PrevisaoVidaUtil`.

- Organizacao 1 → N Contrato, Lote, ChaveApi, RelatorioGerado
- Lote 1 → N Equipamento
- Equipamento 1 → N Movimentacao, Falha
- Destino 1 → N Equipamento
- Usuario 1 → N Movimentacao, Falha (responsável), RelatorioGerado (quem pediu)
- Departamento 1 → N Usuario
- RelatorioGerado 1 → N PrevisaoVidaUtil

Todos os ids são **UUID**.

---

## 9. Regras de negócio

### Contratos
- Uma organização pode ter **vários contratos** (histórico), mas os períodos **não podem se sobrepor**.
- O contrato **vigente** é calculado na consulta. Cada contrato aparece como `FUTURO`, `VIGENTE` ou `ENCERRADO`.
- Contrato **futuro**: pode ser editado e apagado. **Vigente**: só pode ser **renovado** ou **encerrado** (vencimento = hoje). **Encerrado**: não muda mais.

### Lotes
- Só pode ser criado para organização **ativa e com contrato vigente**, com **pelo menos um equipamento**, numa única transação.
- A **nota fiscal não pode repetir** entre os lotes não cancelados da mesma organização (maiúsculas não importam): evita lote duplicado quando o sistema do parceiro reenvia um pedido.
- **Lote registrado pelo gestor** nasce `RECEBIDO`; a data de entrada não pode ser futura nem ter mais de **90 dias**.
- **Lote avisado pelo parceiro** (API pública) nasce `AGUARDANDO_RECEBIMENTO`, sem data de entrada (o parceiro pode informar a data prevista de chegada). Enquanto não chega, ninguém avalia nem movimenta os equipamentos; o parceiro pode editar, cancelar e mexer nos equipamentos. O gestor **confirma o recebimento** e o lote vira `RECEBIDO`, com a data real. Depois disso, só a greencode altera.
- O gestor edita e cancela o lote enquanto ele está `AGUARDANDO_RECEBIMENTO` ou `RECEBIDO`. Cancelar o lote cancela todos os equipamentos dele.
- Não recebe equipamento novo se estiver `CANCELADO` ou `FINALIZADO`.
- O **status do lote muda sozinho**, na mesma transação de cada movimentação, ignorando os equipamentos cancelados:

| Status | Quando |
|---|---|
| `AGUARDANDO_RECEBIMENTO` | Avisado pela API, ainda não chegou |
| `RECEBIDO` | Criado pelo gestor, ou recebimento confirmado |
| `EM_TRIAGEM` | O primeiro equipamento sai de `AGUARDANDO_TRIAGEM` |
| `TRIAGEM_CONCLUIDA` | Nenhum equipamento em `AGUARDANDO_TRIAGEM` ou `EM_TRIAGEM` |
| `ENCAMINHADO` | Todos já têm destino (peças, reciclável ou descarte) |
| `FINALIZADO` | Todos em `BAIXA_DEFINITIVA` |

- **Lote parado:** em `AGUARDANDO_RECEBIMENTO`, `RECEBIDO` ou `EM_TRIAGEM` por mais dias que o configurado em Parametros (padrão: 30).

### Equipamentos
- O código de barras é **gerado pelo sistema** (`GC-AAAA-000000`, com uma `SEQUENCE` do PostgreSQL).
- Pode ser editado só enquanto `AGUARDANDO_TRIAGEM`. O **estado físico** muda pela avaliação; se cair **2 ou mais níveis**, a justificativa é obrigatória.
- O **status** muda só pela movimentação, seguindo estas transições:

| De | Para |
|---|---|
| `AGUARDANDO_TRIAGEM` | `EM_TRIAGEM`, `CANCELADO` |
| `EM_TRIAGEM` | `AGUARDANDO_DESMONTE`, `PECAS_REAPROVEITADAS`, `MATERIAL_RECICLAVEL`, `DESCARTE_SEGURO` |
| `AGUARDANDO_DESMONTE` | `EM_DESMONTE` |
| `EM_DESMONTE` | `PECAS_REAPROVEITADAS`, `MATERIAL_RECICLAVEL`, `DESCARTE_SEGURO` |
| `PECAS_REAPROVEITADAS`, `MATERIAL_RECICLAVEL`, `DESCARTE_SEGURO` | `BAIXA_DEFINITIVA` |
| `BAIXA_DEFINITIVA`, `CANCELADO` | (finais) |

- Para ir a peças, reciclável ou descarte, é obrigatório informar o **destino** (parceiro ativo).
- **Valor de recuperação:** ao mandar para `PECAS_REAPROVEITADAS` ou `MATERIAL_RECICLAVEL`, o gestor informa quanto o parceiro de destino pagou (obrigatório); no `DESCARTE_SEGURO`, o padrão é 0. A baixa definitiva mantém o valor; uma correção que volta para antes do destino o retira (a auditoria guarda o antigo). O valor é **segredo comercial**: nunca aparece na API pública.
- O último equipamento ativo de um lote não pode ser cancelado: para cancelar todos, cancela-se o lote.
- **Toda mudança de status gera uma Movimentacao**, na mesma transação. A movimentação nunca é editada nem apagada.
- **Correção de movimentação errada** (`POST /equipamentos/:id/corrigir`): desfaz a movimentação escolhida e todas as seguintes, com justificativa; nada é apagado. Os relatórios ignoram as movimentações desfeitas.
- **Depreciação** (linear): taxa anual do tipo × idade, com limite de 100%.

### Falhas
- O gestor registra cada defeito encontrado na **triagem ou no desmonte** (equipamento em `EM_TRIAGEM`, `AGUARDANDO_DESMONTE` ou `EM_DESMONTE`): tipo (13 tipos, de `NAO_LIGA` a `OXIDACAO_CORROSAO`, mais `OUTRO`, que exige descrição) e gravidade (`LEVE`, `MODERADA`, `GRAVE`).
- Falha não é editada nem apagada: registrada por engano, é **anulada** com justificativa. Os relatórios ignoram as anuladas.
- O parceiro vê as falhas válidas (tipo, gravidade e data) como **laudo** do equipamento; a descrição é anotação interna.

### Usuários e segurança
- Senhas com **bcrypt** (mínimo de 8 caracteres, 1 maiúscula e 1 número). **5 senhas erradas** bloqueiam a conta por **15 minutos**. Senha criada ou redefinida pelo administrador é **provisória**.
- Chaves de API guardadas como **hash SHA-256**; segredo do webhook nunca sai nas consultas. A auditoria nunca grava senha, hash de chave nem segredo de webhook (só a marca de que mudou).
- Todo usuário pertence a um **departamento**. Departamento e papel são independentes.

### Nada é apagado de verdade
- Usuário, departamento, organização e destino são **desativados**; lote e equipamento são **cancelados**; falha é **anulada**; chave de API é **revogada**.
- Exceções: o contrato futuro, que ainda não começou, e os relatórios analíticos (gerados pelo sistema a partir dos dados, que continuam lá).

### Certificado de destinação final (PDF)
- Inspirado no **CDF** usado no Brasil. Por **lote** ou por **organização e período**, só de lotes **FINALIZADOS**. Gerado na hora com **pdfkit**.
- Pedido pela API pública, sai como "Emitido por solicitação de <organização> pela API pública".

### Relatório financeiro
Como na AV1: cada contrato entra com **valor mensal ÷ 30 × dias vigentes dentro do período**, mais impostos pela alíquota dos parâmetros.

---

## 10. Decisões e justificativas

As decisões da AV3 (biblioteca de estatística, modelagem das tabelas analíticas, política de retry, escalabilidade para centenas ou milhares de parceiros e as demais escolhas) estão explicadas no **[Relatório Técnico](RELATORIO_TECNICO.md)**.

Itens pedidos nos enunciados e onde estão:

| Item | Como foi feito |
|---|---|
| Prisma + PostgreSQL | `prisma/schema.prisma`, com migrações versionadas |
| JWT | `@fastify/jwt`, token de 30 minutos |
| `$transaction` | Todas as gravações passam por `executarTransacao` (`src/lib/transacao.ts`); travas `SELECT ... FOR UPDATE` no lote (status) e na organização (geração de chave) |
| Versionamento otimista | Campo `versao`; versão desatualizada responde **409** |
| Seed | `prisma/seed.ts` e `prisma/seedHistorico.ts` |
| Unicidade | CNPJ, `codigoBarrasInterno`, `login`, hash da chave de API; nota fiscal por organização (no service) |
| Triggers | Auditoria em todas as tabelas de cadastro e movimentação; proteção contra alterar ou apagar Auditoria e Movimentacao |
| Porta por variável de ambiente e graceful shutdown | `PORT`; `src/server.ts` (fecha servidor, workers, fila e banco) |
| Camada analítica | `src/services/analise/`, `RelatorioGerado`, `PrevisaoVidaUtil`, simple-statistics |
| Chave de API com permissões | `ChaveApi`, `src/plugins/chaveApi.ts`, `src/services/chaveApiService.ts` (parte do módulo de autenticação) |
| Limite de taxa por cliente | `@fastify/rate-limit`, limite por chave contado por organização |
| Rotas públicas separadas das internas | `/api/v1/public` e `/api/v1/internal`, com políticas de segurança diferentes |
| Versão explícita | `/v1` na URL e cabeçalho `api-version` (versionamento semântico) |
| Documentação OpenAPI | Swagger em `/docs`, com exemplos de requisição e resposta, códigos de erro e descrição dos parâmetros |
| Processamento assíncrono | BullMQ + Redis: 202 com id, status por polling, webhook assinado, download em CSV ou JSON |
| Tarefas agendadas | Agendamento recorrente do BullMQ (dia 1º, 3h) |

---

## 11. Testes

```bash
npm test
```

São 39 testes automatizados (Node test runner):

- `tests/regras.test.ts`: regras puras, sem banco (CNPJ, senha, transições de status, status do lote, chave de API, estatística, regressão linear, previsão do inventário, CSV, assinatura do webhook).
- `tests/api.test.ts`: requisições à API com `app.inject`, usando os dados do seed. Conferem permissões, validação, filtros, auditoria sem segredos, a proteção do trigger e, na API pública: 401 sem chave, isolamento entre organizações (404), histórico sem funcionário e sem valor, pedido de relatório em fila (202), rentabilidade proibida, webhook só https e o limite de requisições (429).

> Rode o `npx prisma db seed` antes e deixe o **Redis ligado** (`docker compose up -d redis`): o teste do pedido em fila coloca uma tarefa no Redis. Os testes de API só fazem consultas (ou apagam o que criaram, no caso dos relatórios), porque Auditoria e Movimentacao não podem ser apagadas. O fluxo de escrita completo é exercitado pelo seed, que usa os services do sistema.

---

## 12. Limitações conhecidas e melhorias futuras

- **Token depois da desativação.** O JWT não consulta o banco: um usuário desativado continua com acesso até o token vencer (no máximo 30 minutos).
- **Contador do limite na memória.** Com um servidor só, funciona; com vários servidores atrás de um balanceador, cada um contaria separado. Melhoria: guardar o contador no Redis, que já faz parte do projeto (`@fastify/rate-limit` aceita).
- **Webhook e rede interna.** O endereço precisa ser `https`, o que bloqueia a maior parte dos serviços internos, mas um endereço https interno ainda seria aceito. Melhoria: recusar IPs privados.
- **Sobreposição de contratos em pedidos simultâneos.** Melhoria: constraint de exclusão do PostgreSQL (`EXCLUDE USING gist`) nos períodos.
- **Testes de escrita.** Melhoria: um banco só para testes, recriado a cada execução.
- **Front-end (SPA)**, consumindo esta API.
