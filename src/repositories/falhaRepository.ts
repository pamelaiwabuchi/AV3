import { prisma } from "../lib/prisma.js";
import type { Transacao } from "../lib/transacao.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { GravidadeFalha, TipoFalha } from "../generated/prisma/enums.js";
import { montarPagina } from "../utils/paginacao.js";

const TAMANHO_PAGINA = 50;

export interface DadosFalha {
    equipamentoId: string;
    tipo: TipoFalha;
    gravidade: GravidadeFalha;
    descricao: string | null;
    responsavelId: string;
}

export type FiltrosFalha = Prisma.FalhaWhereInput;

const COM_EQUIPAMENTO_E_RESPONSAVEL = {
    equipamento: { select: { codigoBarrasInterno: true, tipo: true, marca: true, modelo: true } },
    responsavel: { select: { nome: true, login: true } },
};

export async function listarFalhas(pagina: number, filtros: FiltrosFalha) {
    const [itens, total] = await Promise.all([
        prisma.falha.findMany({
            where: filtros,
            include: COM_EQUIPAMENTO_E_RESPONSAVEL,
            orderBy: { dataRegistro: "desc" },
            skip: (pagina - 1) * TAMANHO_PAGINA,
            take: TAMANHO_PAGINA,
        }),
        prisma.falha.count({ where: filtros }),
    ]);

    return montarPagina(itens, total, pagina, TAMANHO_PAGINA);
}

export async function listarFalhasDoEquipamento(equipamentoId: string) {
    return prisma.falha.findMany({
        where: { equipamentoId },
        include: { responsavel: { select: { nome: true, login: true } } },
        orderBy: { dataRegistro: "asc" },
    });
}

export async function buscarFalhaPorId(id: string) {
    return prisma.falha.findUnique({ where: { id } });
}

export async function criarFalha(tx: Transacao, dados: DadosFalha) {
    return tx.falha.create({ data: dados });
}

// Anula a falha (registro feito por engano). Devolve false se a versão mudou no meio.
export async function anularFalha(tx: Transacao, id: string, versao: number, justificativa: string) {
    const resultado = await tx.falha.updateMany({
        where: { id, versao, anulada: false },
        data: { anulada: true, justificativaAnulacao: justificativa, dataAnulacao: new Date(), versao: { increment: 1 } },
    });

    return resultado.count === 1;
}
