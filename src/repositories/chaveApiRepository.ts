import { prisma } from "../lib/prisma.js";
import type { Transacao } from "../lib/transacao.js";
import type { PermissaoApi } from "../generated/prisma/enums.js";

export interface DadosChaveApi {
    organizacaoId: string;
    hashChave: string;
    prefixo: string;
    permissoes: PermissaoApi[];
    limitePorMinuto: number;
}

// Campos que podem aparecer nas respostas. O hashChave fica de fora de propósito.
const CAMPOS_PUBLICOS = {
    id: true,
    organizacaoId: true,
    prefixo: true,
    permissoes: true,
    limitePorMinuto: true,
    dataCriacao: true,
    ativo: true,
    expiraEm: true,
};

export async function listarChavesDaOrganizacao(organizacaoId: string) {
    return prisma.chaveApi.findMany({
        where: { organizacaoId },
        select: CAMPOS_PUBLICOS,
        orderBy: { dataCriacao: "desc" },
    });
}

export async function buscarChavePorId(id: string) {
    return prisma.chaveApi.findUnique({
        where: { id },
        select: CAMPOS_PUBLICOS,
    });
}

// Usada em toda requisição de parceiro: acha a chave pelo hash
// e já traz a organização, para conferir se ela está ativa.
export async function buscarChavePorHash(hashChave: string) {
    return prisma.chaveApi.findUnique({
        where: { hashChave },
        include: { organizacao: { select: { id: true, razaoSocial: true, ativo: true } } },
    });
}

export async function criarChave(tx: Transacao, dados: DadosChaveApi) {
    return tx.chaveApi.create({
        data: dados,
        select: CAMPOS_PUBLICOS,
    });
}

// Revoga (desativa) na hora todas as chaves ativas da organização.
export async function revogarChavesAtivas(tx: Transacao, organizacaoId: string) {
    await tx.chaveApi.updateMany({
        where: { organizacaoId, ativo: true },
        data: { ativo: false },
    });
}

// Período de transição: as chaves ativas (que ainda não tinham prazo) passam a valer só até expiraEm.
export async function marcarExpiracaoDasAtivas(tx: Transacao, organizacaoId: string, expiraEm: Date) {
    await tx.chaveApi.updateMany({
        where: { organizacaoId, ativo: true, expiraEm: null },
        data: { expiraEm },
    });
}

// Revoga uma chave. Devolve false se ela já estava revogada.
export async function revogarChave(tx: Transacao, id: string) {
    const resultado = await tx.chaveApi.updateMany({
        where: { id, ativo: true },
        data: { ativo: false },
    });

    return resultado.count === 1;
}
