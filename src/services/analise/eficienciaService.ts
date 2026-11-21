// Relatório 1: eficiência operacional.
// - Tempo médio do lote, da entrada até a conclusão da triagem (nenhum equipamento
//   em AGUARDANDO_TRIAGEM ou EM_TRIAGEM).
// - Gargalos: quanto tempo os equipamentos ficam parados em cada etapa.
// - Variação entre operadores (quem fez a triagem) e entre meses do ano.
import type { StatusRastreamento } from "../../generated/prisma/enums.js";
import * as analiseRepository from "../../repositories/analiseRepository.js";
import { foiDesfeita } from "../../utils/correcoes.js";
import type { Correcao } from "../../utils/correcoes.js";
import { somarDias } from "../../utils/datas.js";
import { agrupar, arredondar, resumir } from "../../utils/estatistica.js";

const UM_DIA = 24 * 60 * 60 * 1000;

const NOMES_DAS_ETAPAS: Partial<Record<StatusRastreamento, string>> = {
    AGUARDANDO_TRIAGEM: "Esperando a triagem começar",
    EM_TRIAGEM: "Em triagem",
    AGUARDANDO_DESMONTE: "Esperando o desmonte",
    EM_DESMONTE: "Em desmonte",
    PECAS_REAPROVEITADAS: "Com o parceiro de peças até a baixa",
    MATERIAL_RECICLAVEL: "Com a recicladora até a baixa",
    DESCARTE_SEGURO: "No descarte seguro até a baixa",
};

// Etapas que dependem da equipe da greencode (o tempo com o parceiro até a baixa, não).
const ETAPAS_INTERNAS: string[] = ["AGUARDANDO_TRIAGEM", "EM_TRIAGEM", "AGUARDANDO_DESMONTE", "EM_DESMONTE"];

type Lote = Awaited<ReturnType<typeof analiseRepository.listarLotesComHistorico>>[number];
type Movimentacao = Lote["equipamentos"][number]["historicoMovimentacao"][number];

interface TempoNaEtapa {
    etapa: StatusRastreamento;
    dias: number;
}

interface TriagemFeita {
    operador: string;
    login: string;
    dias: number;
}

function dias(inicio: number, fim: number) {
    return (fim - inicio) / UM_DIA;
}

// Tira do histórico as movimentações desfeitas por correção e as próprias correções.
function historicoValido(historico: Movimentacao[]) {
    const correcoes: Correcao[] = historico
        .filter((item) => item.movimentacaoCorrigidaId !== null)
        .map((item) => ({ equipamentoId: item.equipamentoId, desfezDesde: item.movimentacaoCorrigida?.dataHora ?? item.dataHora, dataHora: item.dataHora }));

    return historico.filter((item) => item.movimentacaoCorrigidaId === null && !foiDesfeita(item, correcoes));
}

// Tempo em cada etapa = da movimentação que entrou nela até a seguinte.
// A espera pela triagem conta a partir da chegada do lote (o aviso pela API vem antes).
function temposPorEtapa(historico: Movimentacao[], chegada: number) {
    const tempos: TempoNaEtapa[] = [];

    for (let i = 0; i < historico.length - 1; i++) {
        const atual = historico[i]!;
        const inicio = Math.max(atual.dataHora.getTime(), atual.destino === "AGUARDANDO_TRIAGEM" ? chegada : 0);
        tempos.push({ etapa: atual.destino, dias: Math.max(0, dias(inicio, historico[i + 1]!.dataHora.getTime())) });
    }

    return tempos;
}

function analisarLote(lote: Lote) {
    const chegada = lote.dataEntrada!.getTime();
    const etapas: TempoNaEtapa[] = [];
    const triagens: TriagemFeita[] = [];
    let fimDaTriagem = chegada;
    let triagemConcluida = lote.equipamentos.length > 0;

    for (const equipamento of lote.equipamentos) {
        const historico = historicoValido(equipamento.historicoMovimentacao);
        etapas.push(...temposPorEtapa(historico, chegada));

        const entrouNaTriagem = historico.find((item) => item.destino === "EM_TRIAGEM");
        const saiuDaTriagem = historico.find((item) => item.origem === "EM_TRIAGEM");

        if (!saiuDaTriagem) {
            triagemConcluida = false;
            continue;
        }

        fimDaTriagem = Math.max(fimDaTriagem, saiuDaTriagem.dataHora.getTime());

        if (entrouNaTriagem) {
            const duracao = dias(entrouNaTriagem.dataHora.getTime(), saiuDaTriagem.dataHora.getTime());
            triagens.push({ operador: saiuDaTriagem.responsavel.nome, login: saiuDaTriagem.responsavel.login, dias: duracao });
        }
    }

    const diasAteConcluir = triagemConcluida ? dias(chegada, fimDaTriagem) : null;
    return { mes: lote.dataEntrada!.toISOString().slice(0, 7), diasAteConcluir, etapas, triagens };
}

function resumirEtapas(etapas: TempoNaEtapa[]) {
    const porEtapa = agrupar(etapas, (item) => item.etapa);
    const resumo = [...porEtapa.entries()].map(([etapa, itens]) => ({
        etapa,
        descricao: NOMES_DAS_ETAPAS[etapa as StatusRastreamento] ?? etapa,
        dias: resumir(itens.map((item) => item.dias)),
    }));

    return resumo.sort((a, b) => b.dias.media - a.dias.media);
}

function resumirOperadores(triagens: TriagemFeita[]) {
    const porOperador = agrupar(triagens, (item) => item.login);
    const resumo = [...porOperador.values()].map((itens) => ({
        operador: itens[0]!.operador,
        login: itens[0]!.login,
        diasPorEquipamento: resumir(itens.map((item) => item.dias)),
    }));

    return resumo.sort((a, b) => a.diasPorEquipamento.media - b.diasPorEquipamento.media);
}

// Média de cada mês comparada com a média geral (ex.: +45% = 45% mais lento que o normal).
function resumirMeses(lotes: { mes: string; diasAteConcluir: number | null }[], mediaGeral: number) {
    const concluidos = lotes.filter((lote) => lote.diasAteConcluir !== null);
    const porMes = agrupar(concluidos, (lote) => lote.mes);

    const resumo = [...porMes.entries()].map(([mes, itens]) => {
        const { media, mediana } = resumir(itens.map((item) => item.diasAteConcluir!));
        const variacao = mediaGeral > 0 ? arredondar(((media - mediaGeral) / mediaGeral) * 100, 1) : 0;
        return { mes, lotes: itens.length, mediaDias: media, medianaDias: mediana, variacaoPercentual: variacao };
    });

    return resumo.sort((a, b) => a.mes.localeCompare(b.mes));
}

// incluirOperadores = false no relatório do parceiro (ele não vê os nomes dos funcionários).
export async function gerar(inicio: Date, fim: Date, organizacaoId: string | null, incluirOperadores: boolean) {
    const lotes = await analiseRepository.listarLotesComHistorico(inicio, somarDias(fim, 1), organizacaoId);
    const analisados = lotes.map(analisarLote);
    const concluidos = analisados.filter((lote) => lote.diasAteConcluir !== null).map((lote) => lote.diasAteConcluir!);
    const tempoAteConcluir = resumir(concluidos);
    const etapas = resumirEtapas(analisados.flatMap((lote) => lote.etapas));
    const meses = resumirMeses(analisados, tempoAteConcluir.media);

    const resultado = {
        periodo: { inicio, fim },
        lotesAnalisados: lotes.length,
        lotesComTriagemConcluida: concluidos.length,
        lotesAindaEmTriagem: lotes.length - concluidos.length,
        diasDaEntradaAteConcluirTriagem: tempoAteConcluir,
        // Etapa interna em que os equipamentos ficam mais tempo parados.
        gargalo: etapas.find((etapa) => ETAPAS_INTERNAS.includes(etapa.etapa)) ?? null,
        etapas,
        porMes: meses,
        mesMaisLento: [...meses].sort((a, b) => b.mediaDias - a.mediaDias)[0] ?? null,
        mesMaisRapido: [...meses].sort((a, b) => a.mediaDias - b.mediaDias)[0] ?? null,
    };

    if (!incluirOperadores) {
        return resultado;
    }

    return { ...resultado, porOperador: resumirOperadores(analisados.flatMap((lote) => lote.triagens)) };
}
