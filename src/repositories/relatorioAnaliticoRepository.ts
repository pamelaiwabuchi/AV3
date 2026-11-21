import { prisma } from "../lib/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { OrigemRelatorio, TipoRelatorio } from "../generated/prisma/enums.js";
import type { PrevisaoDoTipo } from "../services/analise/vidaUtilService.js";
import { montarPagina } from "../utils/paginacao.js";

const TAMANHO_PAGINA = 20;

export interface DadosPedido {
    tipo: TipoRelatorio;
    origem: OrigemRelatorio;
    parametros: Prisma.InputJsonValue;
    periodoInicio: Date | null;
    periodoFim: Date | null;
    organizacaoId: string | null;
    solicitadoPorId: string | null;
}

export type FiltrosRelatorio = Prisma.RelatorioGeradoWhereInput;

// Na listagem não vem o resultado (pode ser grande): só os dados do pedido.
const CAMPOS_DA_LISTA = {
    id: true,
    tipo: true,
    origem: true,
    status: true,
    periodoInicio: true,
    periodoFim: true,
    organizacaoId: true,
    dataPedido: true,
    dataConclusao: true,
    tentativas: true,
    erro: true,
    solicitadoPor: { select: { nome: true, login: true } },
    organizacao: { select: { razaoSocial: true } },
};

export async function criarPedido(dados: DadosPedido) {
    return prisma.relatorioGerado.create({ data: dados });
}

export async function listar(pagina: number, filtros: FiltrosRelatorio) {
    const [itens, total] = await Promise.all([
        prisma.relatorioGerado.findMany({
            where: filtros,
            select: CAMPOS_DA_LISTA,
            orderBy: { dataPedido: "desc" },
            skip: (pagina - 1) * TAMANHO_PAGINA,
            take: TAMANHO_PAGINA,
        }),
        prisma.relatorioGerado.count({ where: filtros }),
    ]);

    return montarPagina(itens, total, pagina, TAMANHO_PAGINA);
}

export async function buscarPorId(id: string) {
    return prisma.relatorioGerado.findUnique({
        where: { id },
        include: {
            solicitadoPor: { select: { nome: true, login: true } },
            organizacao: { select: { razaoSocial: true } },
            previsoes: { orderBy: { tipoEquipamento: "asc" } },
        },
    });
}

export async function marcarProcessando(id: string) {
    await prisma.relatorioGerado.update({
        where: { id },
        data: { status: "PROCESSANDO", tentativas: { increment: 1 }, erro: null },
    });
}

// Guarda o resultado e, no relatório de vida útil, uma linha por tipo de equipamento.
export async function concluir(id: string, resultado: Prisma.InputJsonValue, previsoes: PrevisaoDoTipo[]) {
    const linhas = previsoes.map((previsao) => ({
        relatorioId: id,
        tipoEquipamento: previsao.tipoEquipamento,
        amostras: previsao.amostras,
        coeficienteAngular: previsao.coeficienteAngular,
        intercepto: previsao.intercepto,
        r2: previsao.r2,
        limiarInservivel: previsao.limiarInservivel,
        vidaUtilPrevistaAnos: previsao.vidaUtilPrevistaAnos,
        vidaUtilContabilAnos: previsao.vidaUtilContabilAnos,
    }));

    await prisma.$transaction([
        prisma.relatorioGerado.update({ where: { id }, data: { status: "CONCLUIDO", resultado, dataConclusao: new Date(), erro: null } }),
        prisma.previsaoVidaUtil.createMany({ data: linhas }),
    ]);
}

// definitivo = false: volta para PENDENTE (vai ser tentado de novo); true: FALHOU.
// updateMany: se o relatório não existir, não dá erro (não há o que marcar).
export async function registrarFalha(id: string, erro: string, definitivo: boolean) {
    await prisma.relatorioGerado.updateMany({
        where: { id },
        data: { status: definitivo ? "FALHOU" : "PENDENTE", erro },
    });
}

// erro = null: aviso entregue; com texto: erro da última tentativa de avisar.
export async function registrarEntregaDoWebhook(id: string, erro: string | null) {
    await prisma.relatorioGerado.updateMany({
        where: { id },
        data: erro ? { webhookErro: erro } : { webhookEntregueEm: new Date(), webhookErro: null },
    });
}

// Previsões do relatório de vida útil mais recente (o "modelo em uso").
export async function buscarUltimasPrevisoes() {
    const ultimo = await prisma.relatorioGerado.findFirst({
        where: { tipo: "VIDA_UTIL", status: "CONCLUIDO" },
        orderBy: { dataConclusao: "desc" },
        include: { previsoes: true },
    });

    return ultimo?.previsoes ?? null;
}
