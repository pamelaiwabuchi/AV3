# Relatório Técnico — AV3 GreenCode

**Disciplina:** Técnicas de Programação — DSM, Fatec
**Aluna:** Pamela Iwabuchi
**Repositório:** <https://github.com/pamelaiwabuchi/AV3>

---

## 1. O que foi feito

O greencode é o sistema de uma empresa de logística reversa de eletrônicos: ele acompanha cada equipamento descartado por uma organização cliente, da chegada do lote até o destino final (peças, reciclagem ou descarte seguro).

Na AV2, o sistema era uma API usada só pelos funcionários. Na AV3 ele ganhou dois pilares:

1. **Camada analítica:** três relatórios (eficiência operacional, rentabilidade e vida útil remanescente) que transformam os dados já guardados em informação para decisão. Os resultados ficam salvos no banco.
2. **API pública:** as organizações clientes integram o sistema delas ao greencode com uma **chave de API**, sem depender de um funcionário: avisam envios de lotes, rastreiam equipamentos, baixam certificados e pedem relatórios.

Os dois pilares se encontram no **processamento assíncrono**: um relatório pesado pedido pela API vai para uma **fila** e é calculado em segundo plano.

A stack continua a da AV2 (Node.js, TypeScript, Fastify, Prisma, PostgreSQL), com três bibliotecas novas: **simple-statistics** (estatística), **@fastify/rate-limit** (limite de requisições) e **BullMQ** com **Redis** (fila).

Visão geral:

```
 Funcionários ──JWT──▶ /api/v1/internal ─┐
                                         ├─▶ Services ─▶ Repositories ─▶ PostgreSQL
 Parceiros ──chave──▶ /api/v1/public ────┘       │
   ▲                (limite por minuto)          │ pedido de relatório
   │                                             ▼
   └──── webhook assinado ◀── Workers ◀──── Fila (BullMQ + Redis)
                               (também rodam o agendamento mensal)
```

---

## 2. Camada analítica

### 2.1 Os três relatórios

| Relatório | Pergunta que responde | Como calcula |
|---|---|---|
| **Eficiência operacional** | Quanto tempo um lote leva da entrada até o fim da triagem? Onde trava? Quem é mais rápido? Quais meses são mais lentos? | Usa as datas das movimentações (que já existiam): tempo em cada etapa, o **gargalo** (etapa interna mais lenta), média por **operador** e por **mês** |
| **Rentabilidade** | Quanto rende cada tipo de equipamento? | Média, mediana e total do **valor de recuperação**, agrupados por tipo, estado físico, marca e modelo |
| **Vida útil remanescente** (preditivo) | Com que idade cada tipo de equipamento fica inservível? | **Regressão linear** do desgaste pela idade, por tipo de equipamento |

Exemplo de resultado com o histórico de exemplo do seed:

| Tipo | Vida útil prevista | Vida útil contábil | R² |
|---|---|---|---|
| Notebook | 8,0 anos | 5 anos | 0,83 |
| Computador de mesa | 10,9 anos | 5 anos | 0,87 |
| Monitor | 12,4 anos | 5 anos | 0,81 |
| Impressora | 9,4 anos | 10 anos | 0,77 |

Uma conclusão útil para o negócio: **a depreciação contábil (taxa de 20% ao ano) zera o notebook em 5 anos, mas na prática ele dura cerca de 8**. Isso ajuda a empresa a planejar as coletas e a avaliar melhor os equipamentos que recebe.

### 2.2 Por que a biblioteca simple-statistics

O enunciado sugeria **simple-statistics** ou **mathjs**. Escolhi a simple-statistics porque:

- ela tem exatamente o que os relatórios usam: **média, mediana, desvio padrão, percentil e regressão linear com R²**;
- é pequena e focada (a mathjs é muito maior, com matrizes, unidades e álgebra, e usaríamos uma parte mínima dela);
- já vem com tipos para TypeScript;
- o código fica fácil de ler: `linearRegression(pontos)` devolve a reta direto.

### 2.3 O modelo preditivo: regressão linear

O enunciado sugeria duas técnicas: regressão linear simples pelo método dos mínimos quadrados, ou suavização exponencial. Escolhi a regressão linear por mínimos quadrados, porque a pergunta é "com que idade o equipamento fica inservível?", e isso é uma relação entre idade e desgaste. O método dos mínimos quadrados escolhe a reta que fica mais perto de todos os pontos ao mesmo tempo: é a reta em que a soma dos erros ao quadrado é a menor possível. A suavização exponencial serve para séries ao longo do tempo (ex.: quantas falhas por mês) e responderia outra pergunta.

Como funciona:

1. Para cada equipamento já avaliado na triagem, calculo a **idade** (ano de entrada − ano de fabricação) e um **índice de desgaste**:
   - nível do estado físico: NOVO = 0, BOM_ESTADO = 1 ... INSERVIVEL = 6;
   - mais pontos das falhas registradas: LEVE 0,5; MODERADA 1; GRAVE 2.
2. Para cada tipo de equipamento, a regressão traça a reta `desgaste = a + b × idade`.
3. O **limiar de inservível** é o desgaste médio dos equipamentos que de fato chegaram INSERVÍVEIS.
4. A **vida útil prevista** é a idade em que a reta chega nesse limiar.
5. O **R²** (de 0 a 1) diz o quanto confiar na previsão. Tipos com menos de 5 equipamentos avaliados aparecem como "dados insuficientes", em vez de uma previsão sem base.

Assim o modelo usa os dois dados que o enunciado cita: **depreciação** (comparação com a vida útil contábil dos parâmetros) e **falhas** (no índice de desgaste).

O mesmo modelo responde o pedido do parceiro: ele manda a lista dos equipamentos que ainda usa (tipo e ano), e o sistema devolve quantos anos cada um ainda tem e quantos devem ficar inservíveis em cada ano. Para o parceiro isso planeja as trocas; para a greencode, as próximas coletas.

### 2.4 Dados que faltavam na AV2

Os relatórios precisavam de dois dados que a AV2 não tinha:

- **Valor de recuperação:** quanto o parceiro de destino pagou pelo equipamento. O gestor informa o valor ao mandar o equipamento para PEÇAS ou RECICLÁVEL (é obrigatório nesses dois); no DESCARTE SEGURO o padrão é 0. Escolhi o **valor real** em vez de uma tabela de preços fixa, porque com tabela fixa todo notebook "em bom estado" valeria o mesmo, e o relatório por marca e modelo não mostraria diferença nenhuma.
- **Falhas:** nova tabela `Falha`. O gestor registra cada defeito encontrado na triagem ou no desmonte (tipo e gravidade). Registro errado não é apagado: é **anulado** com justificativa, seguindo a regra do sistema de que nada é apagado de verdade.

Para os relatórios terem o que analisar, o **seed cria um ano de histórico de exemplo** (42 lotes, cerca de 370 equipamentos). Os números são sorteados com uma semente fixa, então todo banco novo recebe os mesmos dados e os relatórios dão sempre o mesmo resultado.

### 2.5 Como modelei as tabelas dos resultados

Usei duas tabelas novas, num **modelo misto**:

**`RelatorioGerado`**: uma linha por relatório gerado.

| Campo | Para quê |
|---|---|
| `tipo` | EFICIENCIA, RENTABILIDADE, VIDA_UTIL ou VIDA_UTIL_INVENTARIO |
| `origem` | quem pediu: funcionário (INTERNO), parceiro (API) ou agendamento (AGENDADO) |
| `status` | PENDENTE, PROCESSANDO, CONCLUIDO ou FALHOU (é a mesma linha que a fila acompanha) |
| `parametros` | o que foi pedido (período, organização, lista do inventário), em JSON |
| `periodoInicio`, `periodoFim`, `organizacaoId`, `solicitadoPorId` | colunas próprias para filtrar e listar |
| `resultado` | o resultado completo, em **JSON** |
| `dataPedido`, `dataConclusao`, `tentativas`, `erro`, `webhookEntregueEm`, `webhookErro` | acompanhamento do processamento e do aviso |

**`PrevisaoVidaUtil`**: uma linha por tipo de equipamento em cada relatório de vida útil, com os coeficientes da reta, o R², o limiar, a vida útil prevista e a contábil **em colunas**.

Por que assim:

- **O resultado em JSON** porque cada relatório tem um formato diferente (o de eficiência tem etapas e meses; o de rentabilidade, grupos por marca). Uma tabela com colunas para cada relatório seria rígida: qualquer ajuste no relatório viraria uma migração.
- **As previsões em colunas** porque o enunciado pede para **comparar as previsões com o que aconteceu depois**. Com colunas, uma consulta simples mostra, por exemplo, como a vida útil prevista do notebook mudou mês a mês, ou compara a previsão de um ano atrás com a idade real dos notebooks que chegaram inservíveis depois.
- **Relatórios antigos continuam consultáveis:** cada execução é uma linha nova e nunca é alterada depois de concluída.
- Essas tabelas **não têm trigger de auditoria**: são geradas pelo sistema, não são editadas, e o JSON grande seria duplicado inteiro na auditoria. Quem pediu e quando já fica na própria linha.

---

## 3. API pública

### 3.1 Quem é o parceiro e como ele se autentica

O parceiro é a **Organização** cliente (quem envia os lotes). Cada uma recebe uma **chave de API**, gerada por um funcionário (OPERADOR_CADASTRO ou ADMINISTRADOR). A chave é um módulo dentro da autenticação: o JWT identifica **pessoas**; a chave identifica o **sistema** de uma organização.

Decisões:

- **A chave aparece uma vez só**, e o banco guarda o **hash SHA-256** dela, como se faz com senha. Não usei bcrypt aqui: a senha é criada por uma pessoa e pode ser adivinhada, por isso precisa de um hash lento; a chave tem 32 bytes sorteados, impossível de adivinhar, e o hash precisa ser rápido e sempre igual, para o servidor achar a chave no banco a cada requisição.
- **Permissões conforme o contrato:** LER_RASTREABILIDADE, GERENCIAR_LOTES, GERAR_RELATORIOS e ATUALIZAR_CADASTRO. Sem a permissão, a resposta é 403.
- **Troca sem derrubar o parceiro:** ao gerar uma chave nova, a antiga ainda vale por **24 horas**, para o parceiro atualizar o sistema dele. Se houver suspeita de vazamento, o operador marca `revogarAnteriorNaHora` e a antiga para na hora.
- **Conta de serviço:** o que o parceiro grava fica registrado em nome do usuário `api.parceiros` (que não faz login). Assim continuam valendo as regras da AV2 de que toda movimentação tem um responsável e toda alteração vai para a auditoria, sem mudar essas tabelas.
- **Isolamento:** o parceiro só vê os dados da própria organização. Pedir um lote de outra organização responde **404** (e não 403), para não revelar que aquele lote existe.
- **Segredo comercial:** o valor de recuperação (quanto a greencode ganhou) e os nomes dos funcionários não aparecem na API pública.

### 3.2 Regras de negócio novas para o parceiro

- **Lote aguardando recebimento:** quando o parceiro envia um lote pela API, os equipamentos **ainda estão com ele**. Por isso o lote nasce `AGUARDANDO_RECEBIMENTO`, e o gestor confirma a chegada. Se nascesse "recebido", o relatório de eficiência contaria tempo antes de a carga chegar. O parceiro pode corrigir ou cancelar o aviso até a chegada; depois, só a greencode altera.
- **Nota fiscal repetida** na mesma organização é recusada (409). Isso evita lote duplicado quando o sistema do parceiro reenvia um pedido por causa de uma falha de rede.

### 3.3 Limite de requisições

Usei o `@fastify/rate-limit`, só nas rotas públicas. Cada chave tem o seu **limite por minuto**, definido pelo operador conforme o contrato (padrão 100). O limite é contado depois da conferência da chave, por organização. Passou do limite, a resposta é **429**, com o cabeçalho `retry-after`.

### 3.4 Rotas separadas e versionamento

- `/api/v1/internal`: funcionários, com JWT e papéis.
- `/api/v1/public`: parceiros, com chave, permissões e limite.

Não criei um grupo `/admin`, porque no sistema o que é de administrador já é controlado pelo **papel** do usuário, e um prefixo a mais repetiria essa proteção.

A versão principal está na URL (`v1`). A versão exata vem no cabeçalho `api-version` de toda resposta (`1.0.0`, versionamento semântico). Mudanças compatíveis não mudam a URL; uma mudança que quebre integrações vira `/api/v2`, e a v1 continua por pelo menos 6 meses avisando a desativação (cabeçalhos `Deprecation` e `Sunset`).

### 3.5 Documentação

A documentação OpenAPI é gerada pelo `@fastify/swagger` em `/docs`. Cada rota pública tem exemplo de requisição, exemplo de resposta, os códigos de erro possíveis e a descrição de cada parâmetro. O seed cria uma chave de exemplo para testar tudo direto no navegador.

---

## 4. Processamento assíncrono

### 4.1 O fluxo

1. O parceiro pede um relatório (`POST /api/v1/public/relatorios`).
2. A API grava o pedido como `PENDENTE`, coloca uma tarefa na fila e responde **na hora** com `202` e o id.
3. Um **worker** pega a tarefa, calcula e guarda o resultado (`CONCLUIDO`).
4. O parceiro fica sabendo por **polling** (consulta o status) ou por **webhook** (o greencode avisa o endereço dele).
5. O parceiro baixa o resultado em **CSV** ou **JSON**.

Escolhi a fila **BullMQ com Redis**, como o enunciado sugere: as tarefas ficam guardadas no Redis e não se perdem se o servidor reiniciar. No Windows, o Redis roda pelo Docker, igual ao resto do projeto.

Os relatórios pedidos por funcionários continuam sendo gerados **na hora**, porque levam menos de um segundo. A fila ficou para o que é pesado (pedidos da API) e para o agendamento.

### 4.2 Política de retry (novas tentativas)

| Tarefa | Tentativas | Espera entre elas | Na falha final |
|---|---|---|---|
| Relatório | 3 | 1 min, depois 2 min | status `FALHOU` com a mensagem de erro; o parceiro é avisado pelo webhook; o administrador encontra as falhas em `GET /relatorios/analiticos?status=FALHOU` |
| Aviso por webhook | 5 | 30 s, 1, 2 e 4 min | o erro fica registrado no relatório (`webhookErro`); o resultado continua disponível por consulta |

Por que assim:

- **Espera crescente:** a maioria dos erros que vale a pena repetir é passageira (banco reiniciando, rede instável). Esperar cada vez mais dá tempo para o problema passar, sem martelar o servidor.
- **Erro nos dados não é repetido:** se o pedido veio inválido, a próxima tentativa daria o mesmo erro. Nesses casos a tarefa falha na hora (`UnrecoverableError` do BullMQ).
- **Webhook tenta mais vezes:** o sistema do parceiro pode ficar fora do ar por alguns minutos, e o aviso não pode se perder por isso.
- **Nada some:** a falha fica registrada no próprio pedido, e se a fila estiver fora do ar o pedido fica `FALHOU` e a API responde 503, para o parceiro tentar mais tarde.

### 4.3 Webhook

O parceiro cadastra um endereço **https** (`PUT /api/v1/public/webhook`) e recebe um **segredo**. Cada aviso vai com o cabeçalho `x-greencode-assinatura`, que é um **HMAC-SHA256** do corpo calculado com esse segredo. O parceiro faz a mesma conta do lado dele; se bater, ele sabe que o aviso veio mesmo do greencode e não foi alterado. O segredo nunca aparece nas consultas nem na auditoria.

### 4.4 Onde ficam os arquivos

**Em lugar nenhum.** O resultado já fica no banco, em JSON, então o CSV ou o JSON é montado **na hora do download**. Assim não há pasta para encher, arquivo para apagar ou prazo de expiração, e o download funciona com qualquer servidor, mesmo com vários. O CSV usa `;` e vírgula decimal para abrir direto no Excel em português.

### 4.5 Tarefas agendadas

Usei o **agendamento recorrente do próprio BullMQ** em vez do node-cron. Todo dia 1º, às 3h (horário de Brasília), ele gera a eficiência e a rentabilidade do mês anterior e recalcula a vida útil. O motivo: o node-cron roda dentro de cada servidor, então com dois servidores o relatório sairia duplicado; o agendamento do BullMQ fica guardado no Redis e roda **uma vez só**, além de usar as mesmas tentativas da fila.

---

## 5. Como a arquitetura evolui com centenas ou milhares de parceiros

O que já está preparado:

- **Workers separados:** o servidor pode rodar sem processar a fila (`INICIAR_WORKERS=false`), e os workers rodam em outros processos ou máquinas (`npm run worker`). Com mais pedidos, basta subir mais workers: a fila divide as tarefas entre eles.
- **Servidores sem estado:** a API não guarda arquivos nem sessões (JWT e chave são conferidos a cada requisição, e o resultado do relatório está no banco). Dá para colocar vários servidores atrás de um balanceador de carga.
- **Limite por cliente:** um parceiro que exagera recebe 429 e não derruba os outros.
- **Agendamento sem duplicar**, mesmo com vários servidores.

O que precisaria mudar, por ordem de necessidade:

1. **Contador do limite no Redis:** hoje ele fica na memória de cada servidor. Com vários servidores, cada um contaria separado. O `@fastify/rate-limit` aceita o Redis, que já faz parte do projeto.
2. **Banco:** índices nas colunas mais filtradas pela API pública (organização e status do lote) e, com muito volume, uma réplica só de leitura para os relatórios, que não atrapalharia as gravações do dia a dia.
3. **Relatórios por organização:** hoje o relatório de vida útil analisa todos os equipamentos. Com milhares de parceiros, o modelo seria recalculado só no agendamento, e os pedidos dos parceiros usariam o último modelo salvo (o sistema já faz isso para o inventário).
4. **Monitoramento da fila:** um painel com o tamanho da fila e as falhas, para saber quando subir mais workers.

---

## 6. Alternativas consideradas e rejeitadas

| Alternativa | Por que não |
|---|---|
| mathjs ou contas "na mão" | Muito maior que o necessário / mais código para testar |
| Suavização exponencial | Serve para séries no tempo, não para "com que idade quebra" |
| Tabela de preços fixa para o valor de recuperação | Sem diferença real entre marcas e modelos no relatório |
| Usar só o estado físico como "falha" | Perderia o tipo de defeito; com a tabela de falhas, o parceiro também recebe um laudo |
| bcrypt para a chave de API | Lento em toda requisição e impossível de buscar no banco |
| Uma chave que morre na hora da troca | Derrubaria a integração do parceiro até ele trocar |
| node-cron | Duplicaria tarefas com vários servidores |
| Guardar os arquivos CSV/JSON em disco | Pasta para limpar, prazo de expiração e não funciona bem com vários servidores |
| Relatório de acurácia das previsões | Fora do escopo desta entrega; a tabela `PrevisaoVidaUtil` já permite fazer essa comparação depois |

---

## 7. Limitações conhecidas

- O contador do limite de requisições fica na memória (ver seção 5).
- O webhook exige https, mas não bloqueia endereços https de redes internas.
- O histórico de exemplo é sorteado: ele mostra que os relatórios funcionam, mas as conclusões valem para os dados reais só depois de alguns meses de uso.
- Não há front-end; a API está pronta para um.

---

## 8. Como conferir

As instruções de instalação (Docker, Linux e Windows), o roteiro de teste e a lista de rotas estão no [README](README.md). Resumo: `docker compose up -d --build`, abrir <http://localhost:3333/docs> e usar a chave de exemplo da TechCorp no Authorize. Há 39 testes automatizados (`npm test`).