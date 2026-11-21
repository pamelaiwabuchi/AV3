// Consultas da camada analítica. Só leitura: os relatórios nunca alteram os dados.
import { prisma } from "../lib/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { STATUS_COM_DESTINO } from "../utils/regrasStatus.js";

// Eficiência: lotes que entraram no período, com o histórico de cada equipamento.
export async function listarLotesComHistorico(inicio: Date, fimExclusivo: Date, organizacaoId: string | null) {
    const filtros: Prisma.LoteWhereInput = {
        dataEntrada: { gte: inicio, lt: fimExclusivo },
        statusProcessamento: { not: "CANCELADO" },
    };

    if (organizacaoId) {
        filtros.organizacaoId = organizacaoId;
    }

    return prisma.lote.findMany({
        where: filtros,
        select: {
            id: true,
            notaFiscal: true,
            dataEntrada: true,
            equipamentos: {
                where: { statusRastreamento: { not: "CANCELADO" } },
                select: {
                    id: true,
                    historicoMovimentacao: {
                        orderBy: { dataHora: "asc" },
                        select: {
                            equipamentoId: true,
                            dataHora: true,
                            origem: true,
                            destino: true,
                            movimentacaoCorrigidaId: true,
                            movimentacaoCorrigida: { select: { dataHora: true } },
                            responsavel: { select: { nome: true, login: true } },
                        },
                    },
                },
            },
        },
    });
}

// Rentabilidade: equipamentos com valor de recuperação que chegaram ao destino no período.
export async function listarEquipamentosComValor(inicio: Date, fimExclusivo: Date, organizacaoId: string | null) {
    const filtros: Prisma.EquipamentoWhereInput = {
        valorRecuperacao: { not: null },
        historicoMovimentacao: {
            some: { destino: { in: STATUS_COM_DESTINO }, dataHora: { gte: inicio, lt: fimExclusivo } },
        },
    };

    if (organizacaoId) {
        filtros.lote = { organizacaoId };
    }

    return prisma.equipamento.findMany({
        where: filtros,
        select: {
            tipo: true,
            marca: true,
            modelo: true,
            estadoFisico: true,
            statusRastreamento: true,
            valorRecuperacao: true,
            historicoMovimentacao: {
                where: { destino: { in: STATUS_COM_DESTINO } },
                orderBy: { dataHora: "desc" },
                take: 1,
                select: { destino: true },
            },
        },
    });
}

// Vida útil: equipamentos que já passaram pela triagem (estado físico avaliado),
// com a data de entrada do lote (para calcular a idade) e as falhas válidas.
export async function listarEquipamentosAvaliados() {
    return prisma.equipamento.findMany({
        where: {
            statusRastreamento: { notIn: ["AGUARDANDO_TRIAGEM", "CANCELADO"] },
            lote: { dataEntrada: { not: null } },
        },
        select: {
            tipo: true,
            anoFabricacao: true,
            estadoFisico: true,
            lote: { select: { dataEntrada: true } },
            falhas: { where: { anulada: false }, select: { gravidade: true } },
        },
    });
}
