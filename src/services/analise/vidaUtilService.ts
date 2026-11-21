// Relatório 3: vida útil remanescente (preditivo).
//
// Para cada tipo de equipamento, cruza a IDADE (anos) com um ÍNDICE DE DESGASTE:
//   desgaste = nível do estado físico (NOVO = 0 ... INSERVIVEL = 6)
//            + pontos das falhas válidas (LEVE 0,5; MODERADA 1; GRAVE 2)
// e traça a reta de mínimos quadrados: desgaste = intercepto + coeficienteAngular × idade.
//
// O "limiar de inservível" é o desgaste médio dos equipamentos que chegaram INSERVIVEL.
// Vida útil prevista = idade em que a reta atinge o limiar.
// Compara com a vida útil contábil (100% ÷ taxa de depreciação anual dos Parâmetros).
import { EstadoFisico } from "../../generated/prisma/enums.js";
import type { GravidadeFalha, TipoEquipamento } from "../../generated/prisma/enums.js";
import * as analiseRepository from "../../repositories/analiseRepository.js";
import * as parametrosRepository from "../../repositories/parametrosRepository.js";
import { taxaDeDepreciacao } from "../equipamentoService.js";
import { agrupar, arredondar, regressaoLinear } from "../../utils/estatistica.js";

const NIVEIS: string[] = Object.values(EstadoFisico);
const PONTOS_DA_FALHA: Record<GravidadeFalha, number> = { LEVE: 0.5, MODERADA: 1, GRAVE: 2 };

// Com menos que isso, a reta não é confiável e o tipo sai como "dados insuficientes".
const MINIMO_DE_AMOSTRAS = 5;
const MINIMO_DE_INSERVIVEIS = 3;

interface Ponto {
    tipo: TipoEquipamento;
    idade: number;
    desgaste: number;
    inservivel: boolean;
}

export interface PrevisaoDoTipo {
    tipoEquipamento: TipoEquipamento;
    amostras: number;
    coeficienteAngular: number | null;
    intercepto: number | null;
    r2: number | null;
    confianca: string;
    limiarInservivel: number | null;
    vidaUtilPrevistaAnos: number | null;
    vidaUtilContabilAnos: number | null;
    conclusao: string;
}

type Avaliado = Awaited<ReturnType<typeof analiseRepository.listarEquipamentosAvaliados>>[number];

function converter(equipamento: Avaliado): Ponto {
    const pontosDeFalha = equipamento.falhas.reduce((soma, falha) => soma + PONTOS_DA_FALHA[falha.gravidade], 0);

    return {
        tipo: equipamento.tipo,
        idade: equipamento.lote.dataEntrada!.getUTCFullYear() - equipamento.anoFabricacao,
        desgaste: NIVEIS.indexOf(equipamento.estadoFisico) + pontosDeFalha,
        inservivel: equipamento.estadoFisico === "INSERVIVEL",
    };
}

function media(valores: number[]) {
    return valores.reduce((soma, valor) => soma + valor, 0) / valores.length;
}

// Usa os inservíveis do próprio tipo; se houver poucos, usa os de todos os tipos.
function calcularLimiar(pontosDoTipo: Ponto[], todos: Ponto[]) {
    const doTipo = pontosDoTipo.filter((ponto) => ponto.inservivel);
    const usados = doTipo.length >= MINIMO_DE_INSERVIVEIS ? doTipo : todos.filter((ponto) => ponto.inservivel);

    return usados.length > 0 ? media(usados.map((ponto) => ponto.desgaste)) : null;
}

function nivelDeConfianca(r2: number) {
    if (r2 >= 0.6) {
        return "alta";
    }

    return r2 >= 0.3 ? "média" : "baixa";
}

function montarConclusao(tipo: string, vidaPrevista: number | null, vidaContabil: number | null) {
    if (vidaPrevista === null) {
        return `${tipo}: o desgaste não aumenta com a idade nos dados; não dá para prever a vida útil`;
    }

    if (vidaContabil === null) {
        return `${tipo}: fica inservível por volta de ${vidaPrevista} anos de uso`;
    }

    const diferenca = arredondar(vidaPrevista - vidaContabil, 1);
    const comparacao = diferenca >= 0 ? `${diferenca} anos depois` : `${-diferenca} anos antes`;
    return `${tipo}: fica inservível por volta de ${vidaPrevista} anos, ${comparacao} da depreciação contábil total (${vidaContabil} anos)`;
}

function preverTipo(tipo: TipoEquipamento, pontos: Ponto[], todos: Ponto[], vidaContabil: number | null): PrevisaoDoTipo {
    const vazio = { tipoEquipamento: tipo, amostras: pontos.length, coeficienteAngular: null, intercepto: null, r2: null, limiarInservivel: null, vidaUtilPrevistaAnos: null, vidaUtilContabilAnos: vidaContabil };
    const reta = pontos.length >= MINIMO_DE_AMOSTRAS ? regressaoLinear(pontos.map((ponto) => [ponto.idade, ponto.desgaste])) : null;
    const limiar = calcularLimiar(pontos, todos);

    if (!reta || limiar === null) {
        return { ...vazio, confianca: "dados insuficientes", conclusao: `${tipo}: poucos equipamentos avaliados para prever (mínimo ${MINIMO_DE_AMOSTRAS})` };
    }

    // Reta subindo (desgaste aumenta com a idade): idade em que chega no limiar.
    const vidaPrevista = reta.coeficienteAngular > 0 ? arredondar(Math.max(0, (limiar - reta.intercepto) / reta.coeficienteAngular), 1) : null;

    return {
        ...vazio,
        coeficienteAngular: arredondar(reta.coeficienteAngular, 4),
        intercepto: arredondar(reta.intercepto, 4),
        r2: arredondar(reta.r2, 4),
        confianca: nivelDeConfianca(reta.r2),
        limiarInservivel: arredondar(limiar, 2),
        vidaUtilPrevistaAnos: vidaPrevista,
        conclusao: montarConclusao(tipo, vidaPrevista, vidaContabil),
    };
}

// Calcula as previsões de todos os tipos com os dados atuais.
export async function calcularPrevisoes() {
    const equipamentos = await analiseRepository.listarEquipamentosAvaliados();
    const parametros = await parametrosRepository.buscarParametros();
    const todos = equipamentos.map(converter);
    const porTipo = agrupar(todos, (ponto) => ponto.tipo);
    const previsoes: PrevisaoDoTipo[] = [];

    for (const [tipo, pontos] of porTipo) {
        const taxa = taxaDeDepreciacao(tipo as TipoEquipamento, parametros);
        const vidaContabil = taxa > 0 ? arredondar(100 / taxa, 1) : null;
        previsoes.push(preverTipo(tipo as TipoEquipamento, pontos, todos, vidaContabil));
    }

    return { equipamentosAnalisados: todos.length, previsoes: previsoes.sort((a, b) => a.tipoEquipamento.localeCompare(b.tipoEquipamento)) };
}

export async function gerar() {
    const { equipamentosAnalisados, previsoes } = await calcularPrevisoes();

    return {
        metodo: "Regressão linear por mínimos quadrados (simple-statistics): desgaste × idade, por tipo de equipamento",
        indiceDeDesgaste: "nível do estado físico (NOVO 0 ... INSERVIVEL 6) + falhas válidas (LEVE 0,5; MODERADA 1; GRAVE 2)",
        equipamentosAnalisados,
        previsoes,
    };
}

// ---------- previsão para o inventário do parceiro ----------

export interface ItemDoInventario {
    identificador?: string;
    tipo: TipoEquipamento;
    marca?: string;
    modelo?: string;
    anoFabricacao: number;
}

function situacaoDoItem(anosRestantes: number | null) {
    if (anosRestantes === null) {
        return "SEM_PREVISAO";
    }

    if (anosRestantes <= 0) {
        return "VIDA_UTIL_ESGOTADA";
    }

    return anosRestantes <= 1 ? "TROCAR_EM_ATE_1_ANO" : "EM_USO_NORMAL";
}

// Para cada equipamento que o parceiro ainda usa: quanto tempo falta e em que ano
// ele deve ficar inservível. O resumo por ano ajuda a planejar as próximas coletas.
export function preverInventario(itens: ItemDoInventario[], previsoes: PrevisaoDoTipo[]) {
    const anoAtual = new Date().getFullYear();
    const vidaPorTipo = new Map(previsoes.map((previsao) => [previsao.tipoEquipamento, previsao.vidaUtilPrevistaAnos]));

    const equipamentos = itens.map((item) => {
        const vida = vidaPorTipo.get(item.tipo) ?? null;
        const idade = anoAtual - item.anoFabricacao;
        const anosRestantes = vida === null ? null : arredondar(vida - idade, 1);
        const anoPrevisto = vida === null ? null : item.anoFabricacao + Math.ceil(vida);
        return { ...item, idadeAnos: idade, vidaUtilPrevistaAnos: vida, anosRestantes, anoPrevistoInservivel: anoPrevisto, situacao: situacaoDoItem(anosRestantes) };
    });

    const porAno = agrupar(equipamentos.filter((item) => item.anoPrevistoInservivel !== null), (item) => String(Math.max(anoAtual, item.anoPrevistoInservivel!)));
    const coletasPrevistas = [...porAno.entries()]
        .map(([ano, lista]) => ({ ano: Number(ano), equipamentos: lista.length }))
        .sort((a, b) => a.ano - b.ano);

    return {
        totalDeEquipamentos: equipamentos.length,
        vidaUtilEsgotada: equipamentos.filter((item) => item.situacao === "VIDA_UTIL_ESGOTADA").length,
        trocarEmAte1Ano: equipamentos.filter((item) => item.situacao === "TROCAR_EM_ATE_1_ANO").length,
        coletasPrevistasPorAno: coletasPrevistas,
        equipamentos,
    };
}
