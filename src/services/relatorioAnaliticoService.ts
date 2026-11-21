// Camada analítica: pedidos de relatório, processamento e histórico.
//
// Todo relatório segue o mesmo caminho, venha de onde vier (funcionário, parceiro pela
// API ou agendamento): 1) criarPedido grava a linha PENDENTE; 2) processar calcula e
// guarda o resultado (CONCLUIDO) ou o erro. Assim a fila só precisa chamar processar(id).
import type { Prisma } from "../generated/prisma/client.js";
import type { OrigemRelatorio, TipoEquipamento, TipoRelatorio } from "../generated/prisma/enums.js";
import { ErroNaoEncontrado, ErroRegraNegocio } from "../errors/erros.js";
import * as relatorioAnaliticoRepository from "../repositories/relatorioAnaliticoRepository.js";
import type { FiltrosRelatorio } from "../repositories/relatorioAnaliticoRepository.js";
import * as eficienciaService from "./analise/eficienciaService.js";
import * as rentabilidadeService from "./analise/rentabilidadeService.js";
import * as vidaUtilService from "./analise/vidaUtilService.js";
import type { ItemDoInventario, PrevisaoDoTipo } from "./analise/vidaUtilService.js";
import { hojeSemHora } from "../utils/datas.js";

const UM_DIA = 24 * 60 * 60 * 1000;
const DIAS_DO_PERIODO_PADRAO = 365;

export interface PedidoRelatorio {
    tipo: TipoRelatorio;
    origem: OrigemRelatorio;
    inicio?: Date;
    fim?: Date;
    organizacaoId?: string;
    solicitadoPorId?: string;
    itens?: ItemDoInventario[];
}

// O Prisma guarda JSON: as datas viram texto no formato ISO.
function paraJson(valor: unknown) {
    return JSON.parse(JSON.stringify(valor)) as Prisma.InputJsonValue;
}

// Sem período informado: os últimos 12 meses até hoje.
function montarPeriodo(pedido: PedidoRelatorio) {
    const fim = pedido.fim ?? hojeSemHora();
    const inicio = pedido.inicio ?? new Date(fim.getTime() - DIAS_DO_PERIODO_PADRAO * UM_DIA);

    if (fim < inicio) {
        throw new ErroRegraNegocio("A data final precisa ser igual ou depois da data inicial");
    }

    return { inicio, fim };
}

export async function criarPedido(pedido: PedidoRelatorio) {
    const temPeriodo = pedido.tipo === "EFICIENCIA" || pedido.tipo === "RENTABILIDADE";
    const periodo = temPeriodo ? montarPeriodo(pedido) : null;

    if (pedido.tipo === "VIDA_UTIL_INVENTARIO" && (!pedido.itens || pedido.itens.length === 0)) {
        throw new ErroRegraNegocio("Envie a lista de equipamentos (itens) para a previsão do inventário");
    }

    return relatorioAnaliticoRepository.criarPedido({
        tipo: pedido.tipo,
        origem: pedido.origem,
        parametros: paraJson({ ...periodo, organizacaoId: pedido.organizacaoId ?? null, itens: pedido.itens ?? null }),
        periodoInicio: periodo?.inicio ?? null,
        periodoFim: periodo?.fim ?? null,
        organizacaoId: pedido.organizacaoId ?? null,
        solicitadoPorId: pedido.solicitadoPorId ?? null,
    });
}

// Previsões do último relatório de vida útil; se ainda não existe nenhum, calcula agora.
async function previsoesEmUso(): Promise<PrevisaoDoTipo[]> {
    const guardadas = await relatorioAnaliticoRepository.buscarUltimasPrevisoes();

    if (guardadas && guardadas.length > 0) {
        return guardadas.map((linha) => ({ ...linha, tipoEquipamento: linha.tipoEquipamento as TipoEquipamento, confianca: "", conclusao: "" }));
    }

    return (await vidaUtilService.calcularPrevisoes()).previsoes;
}

type Relatorio = NonNullable<Awaited<ReturnType<typeof relatorioAnaliticoRepository.buscarPorId>>>;

async function calcular(relatorio: Relatorio) {
    const inicio = relatorio.periodoInicio!;
    const fim = relatorio.periodoFim!;
    const organizacaoId = relatorio.organizacaoId;

    if (relatorio.tipo === "EFICIENCIA") {
        // O parceiro (origem API) não vê os nomes dos funcionários.
        return { resultado: await eficienciaService.gerar(inicio, fim, organizacaoId, relatorio.origem !== "API"), previsoes: [] };
    }

    if (relatorio.tipo === "RENTABILIDADE") {
        return { resultado: await rentabilidadeService.gerar(inicio, fim, organizacaoId), previsoes: [] };
    }

    if (relatorio.tipo === "VIDA_UTIL") {
        const resultado = await vidaUtilService.gerar();
        return { resultado, previsoes: resultado.previsoes };
    }

    const itens = (relatorio.parametros as unknown as { itens: ItemDoInventario[] }).itens;
    return { resultado: vidaUtilService.preverInventario(itens, await previsoesEmUso()), previsoes: [] };
}

// Calcula e guarda. Em caso de erro, registra a falha e repassa o erro (a fila decide
// se tenta de novo). ultimaTentativa = true marca FALHOU de vez.
export async function processar(id: string, ultimaTentativa = true) {
    const relatorio = await relatorioAnaliticoRepository.buscarPorId(id);

    if (!relatorio) {
        throw new ErroNaoEncontrado("Relatório não encontrado");
    }

    if (relatorio.status === "CONCLUIDO") {
        return;
    }

    await relatorioAnaliticoRepository.marcarProcessando(id);

    try {
        const { resultado, previsoes } = await calcular(relatorio);
        await relatorioAnaliticoRepository.concluir(id, paraJson(resultado), previsoes);
    } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        await relatorioAnaliticoRepository.registrarFalha(id, mensagem, ultimaTentativa);
        throw erro;
    }
}

// Pedido + processamento na hora (relatórios internos, que são rápidos).
export async function gerarAgora(pedido: PedidoRelatorio) {
    const relatorio = await criarPedido(pedido);
    await processar(relatorio.id);
    return buscar(relatorio.id);
}

export async function listar(pagina: number, filtros: FiltrosRelatorio) {
    return relatorioAnaliticoRepository.listar(pagina, filtros);
}

export async function buscar(id: string) {
    const relatorio = await relatorioAnaliticoRepository.buscarPorId(id);

    if (!relatorio) {
        throw new ErroNaoEncontrado("Relatório não encontrado");
    }

    return relatorio;
}
