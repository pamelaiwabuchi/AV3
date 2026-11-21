import { test } from "node:test";
import assert from "node:assert/strict";
import { validarCnpj } from "../src/utils/cnpj.js";
import { calcularStatusLote, podeMudarStatus } from "../src/utils/regrasStatus.js";
import { validarForcaSenha } from "../src/services/authService.js";
import { calcularHashChave, gerarChaveApi } from "../src/utils/chaveApi.js";
import { regressaoLinear, resumir } from "../src/utils/estatistica.js";
import { preverInventario } from "../src/services/analise/vidaUtilService.js";
import type { PrevisaoDoTipo } from "../src/services/analise/vidaUtilService.js";
import { paraCsv } from "../src/utils/csv.js";
import { assinar } from "../src/services/webhookService.js";

test("CNPJ válido com ou sem máscara vira só números", () => {
    assert.equal(validarCnpj("11.222.333/0001-81"), "11222333000181");
    assert.equal(validarCnpj("11222333000181"), "11222333000181");
});

test("CNPJ com dígito errado, tamanho errado ou repetido é recusado", () => {
    assert.throws(() => validarCnpj("11.222.333/0001-82"), /CNPJ inválido/);
    assert.throws(() => validarCnpj("123"), /CNPJ inválido/);
    assert.throws(() => validarCnpj("11111111111111"), /CNPJ inválido/);
});

test("senha forte precisa de 8 caracteres, 1 maiúscula e 1 número", () => {
    assert.doesNotThrow(() => validarForcaSenha("Abcd1234"));
    assert.throws(() => validarForcaSenha("Abc1234"));
    assert.throws(() => validarForcaSenha("abcd1234"));
    assert.throws(() => validarForcaSenha("Abcdefgh"));
});

test("transições de status permitidas e proibidas", () => {
    assert.equal(podeMudarStatus("AGUARDANDO_TRIAGEM", "EM_TRIAGEM"), true);
    assert.equal(podeMudarStatus("AGUARDANDO_TRIAGEM", "EM_DESMONTE"), false);
    assert.equal(podeMudarStatus("EM_TRIAGEM", "CANCELADO"), false);
    assert.equal(podeMudarStatus("DESCARTE_SEGURO", "BAIXA_DEFINITIVA"), true);
    assert.equal(podeMudarStatus("BAIXA_DEFINITIVA", "EM_TRIAGEM"), false);
});

test("status do lote é calculado pelos equipamentos, ignorando os cancelados", () => {
    assert.equal(calcularStatusLote(["AGUARDANDO_TRIAGEM", "AGUARDANDO_TRIAGEM"]), "RECEBIDO");
    assert.equal(calcularStatusLote(["EM_TRIAGEM", "AGUARDANDO_TRIAGEM"]), "EM_TRIAGEM");
    assert.equal(calcularStatusLote(["AGUARDANDO_DESMONTE", "MATERIAL_RECICLAVEL"]), "TRIAGEM_CONCLUIDA");
    assert.equal(calcularStatusLote(["PECAS_REAPROVEITADAS", "BAIXA_DEFINITIVA"]), "ENCAMINHADO");
    assert.equal(calcularStatusLote(["BAIXA_DEFINITIVA", "CANCELADO"]), "FINALIZADO");
});

test("chave de API: formato gc_ + 64 caracteres, prefixo e hash que dá para conferir", () => {
    const { chave, hash, prefixo } = gerarChaveApi();

    assert.match(chave, /^gc_[0-9a-f]{64}$/);
    assert.equal(prefixo, chave.slice(0, 7));
    assert.equal(hash, calcularHashChave(chave));
    assert.notEqual(hash, chave);
    assert.notEqual(gerarChaveApi().chave, chave);
});

test("estatística: resumo de uma lista e lista vazia", () => {
    const resumo = resumir([2, 4, 4, 4, 5, 5, 7, 9]);

    assert.equal(resumo.quantidade, 8);
    assert.equal(resumo.media, 5);
    assert.equal(resumo.mediana, 4.5);
    assert.equal(resumo.desvioPadrao, 2);
    assert.equal(resumir([]).media, 0);
});

test("regressão linear: reta exata, R² = 1, e sem reta quando todo x é igual", () => {
    // Pontos em cima da reta y = 1 + 0,5x
    const reta = regressaoLinear([[0, 1], [2, 2], [4, 3], [6, 4]]);

    assert.ok(reta);
    assert.equal(reta.coeficienteAngular, 0.5);
    assert.equal(reta.intercepto, 1);
    assert.equal(reta.r2, 1);
    assert.equal(regressaoLinear([[3, 1], [3, 2]]), null);
});

test("inventário do parceiro: anos restantes, ano previsto e situação", () => {
    const anoAtual = new Date().getFullYear();
    const previsoes = [{ tipoEquipamento: "NOTEBOOK", vidaUtilPrevistaAnos: 8 }] as PrevisaoDoTipo[];
    const itens = [
        { tipo: "NOTEBOOK" as const, anoFabricacao: anoAtual - 10 },
        { tipo: "NOTEBOOK" as const, anoFabricacao: anoAtual - 7 },
        { tipo: "NOTEBOOK" as const, anoFabricacao: anoAtual - 2 },
        { tipo: "MONITOR" as const, anoFabricacao: anoAtual - 2 },
    ];
    const resultado = preverInventario(itens, previsoes);
    const situacoes = resultado.equipamentos.map((item) => item.situacao);

    assert.deepEqual(situacoes, ["VIDA_UTIL_ESGOTADA", "TROCAR_EM_ATE_1_ANO", "EM_USO_NORMAL", "SEM_PREVISAO"]);
    assert.equal(resultado.equipamentos[2]!.anosRestantes, 6);
    assert.equal(resultado.equipamentos[2]!.anoPrevistoInservivel, anoAtual - 2 + 8);
});

test("CSV: separador ;, vírgula decimal, aspas escapadas, colunas na ordem pedida e objetos achatados", () => {
    const csv = paraCsv([{ nome: 'PAT;3 "x"', valor: { media: 1.5 } }, { nome: "B", valor: { media: 2 } }], ["valor.media", "nome"]);
    const linhas = csv.replace("\uFEFF", "").split("\n");

    assert.equal(linhas[0], "valor.media;nome");
    assert.equal(linhas[1], '1,5;"PAT;3 ""x"""');
    assert.equal(linhas[2], "2;B");
});

test("webhook: assinatura HMAC-SHA256 muda se o corpo ou o segredo mudar", () => {
    const assinatura = assinar('{"evento":"relatorio.concluido"}', "whsec_teste");

    assert.match(assinatura, /^[0-9a-f]{64}$/);
    assert.equal(assinatura, assinar('{"evento":"relatorio.concluido"}', "whsec_teste"));
    assert.notEqual(assinatura, assinar('{"evento":"relatorio.falhou"}', "whsec_teste"));
    assert.notEqual(assinatura, assinar('{"evento":"relatorio.concluido"}', "outro"));
});
