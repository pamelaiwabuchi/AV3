import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { criarApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { PREFIXO_INTERNO, PREFIXO_PUBLICO } from "../src/utils/prefixos.js";
import { CHAVE_API_EXEMPLO } from "../src/utils/esquemas.js";
import { fecharFilas, removerTarefaDeRelatorio } from "../src/lib/fila.js";
import net from "node:net";

// Estes testes usam os dados do seed (npx prisma db seed) e só fazem consultas,
// para não deixar registros no banco (Auditoria e Movimentacao não podem ser apagadas).

const app = criarApp();
let tokenAdmin = "";
let tokenGestor = "";
let tokenAuditor = "";

function token(id: string, papel: "ADMINISTRADOR" | "GESTOR_ALMOXARIFADO" | "AUDITOR") {
    return app.jwt.sign({ id, papel, precisaTrocarSenha: false });
}

function pedir(url: string, tokenUsado: string) {
    return app.inject({ url: PREFIXO_INTERNO + url, headers: { authorization: `Bearer ${tokenUsado}` } });
}

// Rota pública com a chave de exemplo da TechCorp (criada pelo seed).
function pedirComChave(url: string, chave = CHAVE_API_EXEMPLO) {
    return app.inject({ url: PREFIXO_PUBLICO + url, headers: { "x-api-key": chave } });
}

// Confere se o Redis está ligado, abrindo uma conexão rápida com a porta dele.
// Sem isso, o teste da fila ficaria parado esperando o Redis para sempre.
function redisRespondendo(): Promise<boolean> {
    const endereco = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
    const porta = Number(endereco.port || 6379);

    return new Promise((resolver) => {
        const conexao = net.connect({ host: endereco.hostname, port: porta });
        conexao.setTimeout(1000);

        conexao.once("connect", () => {
            conexao.end();
            resolver(true);
        });

        conexao.once("error", () => {
            resolver(false);
        });

        conexao.once("timeout", () => {
            conexao.destroy();
            resolver(false);
        });
    });
}

before(async () => {
    await app.ready();
    const admin = await prisma.usuario.findUniqueOrThrow({ where: { login: process.env.ADMIN_LOGIN! } });
    tokenAdmin = token(admin.id, "ADMINISTRADOR");
    tokenGestor = token(admin.id, "GESTOR_ALMOXARIFADO");
    tokenAuditor = token(admin.id, "AUDITOR");
});

after(async () => {
    await app.close();
    await fecharFilas();
    await prisma.$disconnect();
});

test("GET /health responde ok", async () => {
    const resposta = await app.inject({ url: "/health" });
    assert.equal(resposta.statusCode, 200);
});

test("rota protegida sem token responde 401", async () => {
    const resposta = await app.inject({ url: PREFIXO_INTERNO + "/lotes" });
    assert.equal(resposta.statusCode, 401);
});

test("login com usuário inexistente responde 401 com mensagem genérica", async () => {
    const resposta = await app.inject({ method: "POST", url: PREFIXO_INTERNO + "/auth/login", payload: { login: "ninguem", senha: "x" } });
    assert.equal(resposta.statusCode, 401);
    assert.equal(resposta.json().erro, "Login ou senha inválidos");
});

test("login sem senha é barrado pela validação (400)", async () => {
    const resposta = await app.inject({ method: "POST", url: PREFIXO_INTERNO + "/auth/login", payload: { login: "admin" } });
    assert.equal(resposta.statusCode, 400);
});

test("gestor não lista usuários (403) e auditor não altera parâmetros (403)", async () => {
    assert.equal((await pedir("/usuarios", tokenGestor)).statusCode, 403);

    const resposta = await app.inject({
        method: "PATCH",
        url: PREFIXO_INTERNO + "/parametros",
        headers: { authorization: `Bearer ${tokenAuditor}` },
        payload: {},
    });
    assert.equal(resposta.statusCode, 403);
});

test("departamentos do seed e funcionários de um departamento (só ADMINISTRADOR)", async () => {
    const lista = await pedir("/departamentos?busca=almoxarifado", tokenAdmin);
    assert.equal(lista.statusCode, 200);
    const almoxarifado = lista.json().itens.find((departamento: { nome: string }) => departamento.nome === "Almoxarifado");
    assert.ok(almoxarifado);

    const usuarios = await pedir(`/departamentos/${almoxarifado.id}/usuarios`, tokenAdmin);
    const logins = usuarios.json().itens.map((usuario: { login: string }) => usuario.login);
    assert.ok(logins.includes("bruno.gestor"));

    assert.equal((await pedir("/departamentos", tokenGestor)).statusCode, 403);
});

test("usuário pode ser buscado pelo login e filtrado pelo nome do departamento", async () => {
    const porLogin = await pedir("/usuarios/login/carla.auditora", tokenAdmin);
    assert.equal(porLogin.statusCode, 200);
    assert.equal(porLogin.json().departamento.nome, "Financeiro");

    const filtrados = await pedir("/usuarios?departamento=comercial", tokenAdmin);
    const logins = filtrados.json().itens.map((usuario: { login: string }) => usuario.login);
    assert.ok(logins.includes("ana.operadora"));
});

// Estes testes não contam registros: conferem que o filtro traz os dados do seed
// e só eles, para continuarem passando quando alguém cadastra coisas novas.
test("filtros por nome e CNPJ (com ou sem pontuação)", async () => {
    const porNome = (await pedir("/lotes?organizacaoNome=techcorp", tokenAdmin)).json();
    const porCnpj = (await pedir("/lotes?organizacaoCnpj=52.601.815/0001-20", tokenAdmin)).json();
    const notasPorNome = porNome.itens.map((lote: { notaFiscal: string }) => lote.notaFiscal);
    const cnpjsPorCnpj = porCnpj.itens.map((lote: { organizacao: { cnpj: string } }) => lote.organizacao.cnpj);

    assert.ok(notasPorNome.includes("NF-1001"));
    assert.equal(notasPorNome.includes("NF-2001"), false);
    assert.ok(cnpjsPorCnpj.length > 0);
    assert.ok(cnpjsPorCnpj.every((cnpj: string) => cnpj === "52601815000120"));

    const porParceiro = (await pedir("/equipamentos?destinoNome=ecopeças", tokenAdmin)).json();
    const parceiros = porParceiro.itens.map((equipamento: { destino: { razaoSocial: string } }) => equipamento.destino.razaoSocial);
    assert.ok(parceiros.length > 0);
    assert.ok(parceiros.every((nome: string) => nome === "EcoPeças Distribuidora"));
});

test("filtro de ano nos contratos traz só os que valeram naquele ano", async () => {
    const ano = new Date().getFullYear();
    const resposta = (await pedir(`/contratos?ano=${ano}`, tokenAdmin)).json();
    const primeiroDia = `${ano}-01-01`;
    const ultimoDia = `${ano}-12-31`;

    assert.ok(resposta.itens.length > 0);

    for (const contrato of resposta.itens) {
        assert.ok(contrato.dataAssinatura.slice(0, 10) <= ultimoDia);
        assert.ok(contrato.dataVencimento.slice(0, 10) >= primeiroDia);
    }
});

test("listagem de usuários nunca devolve o hash da senha", async () => {
    const resposta = await pedir("/usuarios", tokenAdmin);
    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.body.includes("hashSenha"), false);
});

test("id que não é UUID responde 400", async () => {
    assert.equal((await pedir("/lotes/abc", tokenGestor)).statusCode, 400);
});

test("gestor vê o resumo de organizações só com as ativas e com contrato vigente", async () => {
    const resposta = await pedir("/organizacoes/resumo", tokenGestor);
    const nomes = resposta.json().map((organizacao: { razaoSocial: string }) => organizacao.razaoSocial);

    assert.ok(nomes.includes("TechCorp Soluções Ltda"));
    assert.equal(nomes.includes("Hospital Bem Estar"), false);
});

// Procura o lote do seed pela nota fiscal, e não pela posição na lista,
// porque lotes novos podem aparecer antes dele.
async function loteDoSeed(notaFiscal: string, papelToken: string) {
    const lotes = (await pedir(`/lotes?notaFiscal=${notaFiscal}`, papelToken)).json().itens;
    return lotes.find((lote: { notaFiscal: string }) => lote.notaFiscal === notaFiscal);
}

async function equipamentosDoLoteFinalizado() {
    const lote = await loteDoSeed("NF-1001", tokenAuditor);
    return (await pedir(`/lotes/${lote.id}`, tokenAuditor)).json().equipamentos;
}

test("código de barras gerado segue o padrão GC-AAAA-000000", async () => {
    const [notebook] = await equipamentosDoLoteFinalizado();
    assert.match(notebook.codigoBarrasInterno, /^GC-\d{4}-\d{6}$/);
});

test("busca por código de barras traz a depreciação", async () => {
    const monitor = (await equipamentosDoLoteFinalizado())[1];
    const resposta = await pedir(`/equipamentos/codigo/${monitor.codigoBarrasInterno}`, tokenGestor);
    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json().depreciacao.percentual, 100);
});

test("lote finalizado do seed tem o status calculado certo", async () => {
    const lote = await loteDoSeed("NF-1001", tokenAuditor);
    assert.equal(lote.statusProcessamento, "FINALIZADO");
});

test("histórico do equipamento mostra todas as movimentações em ordem", async () => {
    const [equipamento] = await equipamentosDoLoteFinalizado();
    const historico = (await pedir(`/equipamentos/${equipamento.id}/historico`, tokenAuditor)).json();
    const destinos = historico.map((movimentacao: { destino: string }) => movimentacao.destino);

    assert.deepEqual(destinos, ["AGUARDANDO_TRIAGEM", "EM_TRIAGEM", "PECAS_REAPROVEITADAS", "BAIXA_DEFINITIVA"]);
});

test("lote parado do seed aparece em /lotes/parados", async () => {
    const resposta = await pedir("/lotes/parados", tokenGestor);
    const notas = resposta.json().map((lote: { notaFiscal: string }) => lote.notaFiscal);
    assert.ok(notas.includes("NF-1002"));
});

test("painel do gestor não mostra a parte de cadastro", async () => {
    const painel = (await pedir("/painel", tokenGestor)).json();
    assert.ok(painel.almoxarifado);
    assert.equal(painel.cadastro, undefined);
});

test("auditoria registra quem fez e nunca guarda o hash da senha", async () => {
    const resposta = await pedir("/auditoria?tabela=Usuario", tokenAuditor);
    assert.equal(resposta.statusCode, 200);
    assert.ok(resposta.json().itens.length > 0);
    assert.equal(resposta.body.includes("$2b$"), false);
});

test("banco recusa apagar a auditoria (trigger)", async () => {
    await assert.rejects(prisma.auditoria.deleteMany({}), /não pode ser alterada nem apagada/);
});

test("API pública sem chave ou com chave errada responde 401", async () => {
    const semChave = await app.inject({ url: PREFIXO_PUBLICO + "/conta" });
    assert.equal(semChave.statusCode, 401);

    const chaveErrada = await pedirComChave("/conta", "gc_chave_que_nao_existe");
    assert.equal(chaveErrada.statusCode, 401);
});

test("API pública: a chave de exemplo é da TechCorp e o token de funcionário não serve", async () => {
    const conta = await pedirComChave("/conta");
    assert.equal(conta.statusCode, 200);
    assert.equal(conta.json().organizacao.razaoSocial, "TechCorp Soluções Ltda");
    assert.equal(conta.body.includes("hashChave"), false);

    const comToken = await app.inject({ url: PREFIXO_PUBLICO + "/conta", headers: { authorization: `Bearer ${tokenAdmin}` } });
    assert.equal(comToken.statusCode, 401);
});

test("API pública: parceiro só vê os próprios lotes e equipamentos (os outros dão 404)", async () => {
    const lotes = (await pedirComChave("/lotes")).json();
    const organizacoes = new Set(lotes.itens.map((lote: { organizacao: { razaoSocial: string } }) => lote.organizacao.razaoSocial));
    assert.deepEqual([...organizacoes], ["TechCorp Soluções Ltda"]);

    const loteDaEscola = await prisma.lote.findFirstOrThrow({ where: { notaFiscal: "NF-2001" }, include: { equipamentos: true } });
    assert.equal((await pedirComChave(`/lotes/${loteDaEscola.id}`)).statusCode, 404);

    const codigoDaEscola = loteDaEscola.equipamentos[0]!.codigoBarrasInterno;
    assert.equal((await pedirComChave(`/equipamentos/${codigoDaEscola}`)).statusCode, 404);
});

test("API pública: rastreabilidade mostra o histórico sem o funcionário responsável nem o valor de recuperação", async () => {
    const lote = await prisma.lote.findFirstOrThrow({ where: { notaFiscal: "NF-1001" }, include: { equipamentos: true } });
    const resposta = await pedirComChave(`/equipamentos/${lote.equipamentos[0]!.codigoBarrasInterno}`);

    assert.equal(resposta.statusCode, 200);
    assert.ok(resposta.json().historico.length > 0);
    assert.equal(resposta.body.includes("responsavel"), false);
    assert.equal(resposta.body.includes("valorRecuperacao"), false);

    const detalheDoLote = await pedirComChave(`/lotes/${lote.id}`);
    assert.equal(detalheDoLote.body.includes("valorRecuperacao"), false);
});

test("relatório de vida útil: gestor gera e fica guardado com as previsões; gestor não gera rentabilidade", async () => {
    const pedir = (tipo: string) => app.inject({
        method: "POST",
        url: PREFIXO_INTERNO + "/relatorios/analiticos",
        headers: { authorization: `Bearer ${tokenGestor}` },
        payload: { tipo },
    });

    const resposta = await pedir("VIDA_UTIL");
    assert.equal(resposta.statusCode, 201);

    const relatorio = resposta.json();
    assert.equal(relatorio.status, "CONCLUIDO");
    assert.ok(relatorio.previsoes.length > 0);
    assert.equal((await pedir("RENTABILIDADE")).statusCode, 403);

    // Relatórios podem ser apagados (não são histórico protegido): limpa o que o teste criou.
    await prisma.previsaoVidaUtil.deleteMany({ where: { relatorioId: relatorio.id } });
    await prisma.relatorioGerado.delete({ where: { id: relatorio.id } });
});

test("API pública: pedido de relatório responde 202 na hora e fica na fila (precisa do Redis)", async (t) => {
    if (!(await redisRespondendo())) {
        t.skip("Redis desligado: rode docker compose up -d redis");
        return;
    }

    const itens = [{ identificador: "PAT-1", tipo: "NOTEBOOK", anoFabricacao: 2019 }];
    const resposta = await app.inject({
        method: "POST",
        url: PREFIXO_PUBLICO + "/relatorios",
        headers: { "x-api-key": CHAVE_API_EXEMPLO },
        payload: { tipo: "VIDA_UTIL_INVENTARIO", itens },
    });

    assert.equal(resposta.statusCode, 202);
    const pedido = resposta.json();
    assert.equal(pedido.status, "PENDENTE");
    assert.equal(resposta.headers.location, pedido.links.status);

    // Sem worker rodando no teste: o status continua PENDENTE e o download ainda não existe.
    assert.equal((await pedirComChave(`/relatorios/${pedido.id}`)).json().status, "PENDENTE");
    assert.equal((await pedirComChave(`/relatorios/${pedido.id}/download`)).statusCode, 409);

    // Limpa: tira a tarefa da fila e apaga o pedido.
    await removerTarefaDeRelatorio(pedido.id);
    await prisma.relatorioGerado.delete({ where: { id: pedido.id } });
});

test("API pública: rentabilidade não pode ser pedida (segredo comercial) e webhook só aceita https", async () => {
    const rentabilidade = await app.inject({
        method: "POST",
        url: PREFIXO_PUBLICO + "/relatorios",
        headers: { "x-api-key": CHAVE_API_EXEMPLO },
        payload: { tipo: "RENTABILIDADE" },
    });
    assert.equal(rentabilidade.statusCode, 400);

    const webhookInseguro = await app.inject({
        method: "PUT",
        url: PREFIXO_PUBLICO + "/webhook",
        headers: { "x-api-key": CHAVE_API_EXEMPLO },
        payload: { url: "http://techcorp.com.br/avisos" },
    });
    assert.equal(webhookInseguro.statusCode, 422);
});

// Fica por último: gasta o limite de requisições da chave de exemplo.
test("API pública: passar do limite de requisições por minuto responde 429", async () => {
    let status = 0;

    for (let i = 0; i < 150 && status !== 429; i++) {
        status = (await pedirComChave("/conta")).statusCode;
    }

    assert.equal(status, 429);
});
