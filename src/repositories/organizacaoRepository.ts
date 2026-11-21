import { prisma } from "../lib/prisma.js";
import type { Transacao } from "../lib/transacao.js";
import { hojeSemHora } from "../utils/datas.js";
import { montarPagina } from "../utils/paginacao.js";

const TAMANHO_PAGINA = 20;

// O segredo do webhook nunca sai nas consultas comuns (nem para a tela da organização,
// nem para a API pública). Só buscarWebhook traz ele, para assinar os avisos.
const SEM_SEGREDO = { webhookSegredo: true } as const;

export interface AlteracoesOrganizacao extends Partial<DadosOrganizacao> {
    ativo?: boolean;
}

export interface DadosOrganizacao {
    id?: string; // só o seed informa, para a organização de exemplo ter sempre o mesmo id
    razaoSocial: string;
    cnpj: string;
    inscricaoEstadual: string;
    enderecoCompleto: string;
    telefone: string;
    email: string;
}

function filtroContratoVigente() {
    const hoje = hojeSemHora();

    return {
        some: {
            dataAssinatura: { lte: hoje },
            dataVencimento: { gte: hoje },
        },
    };
}

export async function listarOrganizacoes(pagina: number, busca: string) {
    const where = {
        OR: [
            { razaoSocial: { contains: busca, mode: "insensitive" as const } },
            { cnpj: { contains: busca.replace(/\D/g, "") || busca } },
        ],
    };

    const [itens, total] = await Promise.all([
        prisma.organizacao.findMany({
            where,
            omit: SEM_SEGREDO,
            orderBy: { razaoSocial: "asc" },
            skip: (pagina - 1) * TAMANHO_PAGINA,
            take: TAMANHO_PAGINA,
        }),
        prisma.organizacao.count({ where }),
    ]);

    return montarPagina(itens, total, pagina, TAMANHO_PAGINA);
}

export async function listarResumoParaGestor() {
    return prisma.organizacao.findMany({
        where: { ativo: true, contratos: filtroContratoVigente() },
        select: { id: true, razaoSocial: true, cnpj: true },
        orderBy: { razaoSocial: "asc" },
    });
}

export async function buscarOrganizacaoPorId(id: string) {
    return prisma.organizacao.findUnique({ where: { id }, omit: SEM_SEGREDO });
}

// Trava a linha da organização até o fim da transação (igual ao travarLote).
// Usado ao gerar chave de API: duas gerações ao mesmo tempo esperam uma pela outra.
export async function travarOrganizacao(tx: Transacao, id: string) {
    await tx.$executeRaw`SELECT id FROM "Organizacao" WHERE id = ${id}::uuid FOR UPDATE`;
}

export async function buscarOrganizacaoPorCnpj(cnpj: string) {
    return prisma.organizacao.findUnique({ where: { cnpj }, omit: SEM_SEGREDO });
}

export async function temContratoVigente(id: string) {
    const quantidade = await prisma.organizacao.count({
        where: { id, contratos: filtroContratoVigente() },
    });

    return quantidade > 0;
}

export async function criarOrganizacao(tx: Transacao, dados: DadosOrganizacao) {
    return tx.organizacao.create({ data: dados, omit: SEM_SEGREDO });
}

export async function atualizarOrganizacao(tx: Transacao, id: string, versao: number, alteracoes: AlteracoesOrganizacao) {
    const resultado = await tx.organizacao.updateMany({
        where: { id, versao },
        data: { ...alteracoes, versao: { increment: 1 } },
    });

    return resultado.count === 1;
}

export async function buscarWebhook(id: string) {
    return prisma.organizacao.findUnique({
        where: { id },
        select: { id: true, razaoSocial: true, webhookUrl: true, webhookSegredo: true },
    });
}

// Campos controlados pelo parceiro pela API: não aumentam a versão da organização.
export async function salvarWebhook(tx: Transacao, id: string, webhookUrl: string | null, webhookSegredo: string | null) {
    await tx.organizacao.update({ where: { id }, data: { webhookUrl, webhookSegredo } });
}
