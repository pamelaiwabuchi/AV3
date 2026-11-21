// Camada analítica: pedidos de relatório, processamento e histórico.
//
// Todo relatório segue o mesmo caminho, venha de onde vier (funcionário, parceiro pela
// API ou agendamento): 1) criarPedido grava a linha PENDENTE; 2) processar calcula e
// guarda o resultado (CONCLUIDO) ou o erro. Assim a fila só precisa chamar processar(id).
import type { Prisma } from "../generated/prisma/client.js";
import type { OrigemRelatorio, TipoEquipamento, TipoRelatorio } from "../generated/prisma/enums.js";
import { ErroApp, ErroNaoEncontrado, ErroRegraNegocio } from "../errors/erros.js";
import { enfileirarRelatorio } from "../lib/fila.js";
import { paraCsv } from "../utils/csv.js";
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

export async function marcarFalhaDefinitiva(id: string, mensagem: string) {
    await relatorioAnaliticoRepository.registrarFalha(id, mensagem, true);
}

// Pedido que vai para a fila (API pública e agendamento). Se a fila estiver fora do ar,
// o pedido fica FALHOU (não some) e a resposta é 503, para o cliente tentar mais tarde.
export async function pedirNaFila(pedido: PedidoRelatorio) {
    const relatorio = await criarPedido(pedido);

    try {
        await enfileirarRelatorio(relatorio.id);
    } catch {
        await marcarFalhaDefinitiva(relatorio.id, "A fila de processamento estava indisponível");
        throw new ErroApp("A fila de processamento está indisponível no momento. Tente de novo em alguns minutos", 503);
    }

    return relatorio;
}

// Relatório automático do dia 1º: eficiência e rentabilidade do mês anterior;
// a vida útil é recalculada com todos os dados (o modelo se atualiza todo mês).
export async function pedirAgendado(tipo: "EFICIENCIA" | "RENTABILIDADE" | "VIDA_UTIL") {
    const hoje = new Date();
    const inicio = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1));
    const fim = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 0));

    return pedirNaFila({ tipo, origem: "AGENDADO", inicio, fim });
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

// ---------- download em JSON ou CSV ----------

// O CSV é uma tabela só; cada relatório usa a sua tabela principal, com as colunas
// nesta ordem. O JSON traz o resultado completo.
const TABELAS_DO_CSV: Record<TipoRelatorio, { campo: string; colunas: string[] }> = {
    EFICIENCIA: { campo: "porMes", colunas: ["mes", "lotes", "mediaDias", "medianaDias", "variacaoPercentual"] },
    RENTABILIDADE: {
        campo: "porMarcaEModelo",
        colunas: ["tipo", "marca", "modelo", "valor.quantidade", "valor.media", "valor.mediana", "valor.desvioPadrao", "valor.minimo", "valor.maximo", "valorTotal"],
    },
    VIDA_UTIL: {
        campo: "previsoes",
        colunas: ["tipoEquipamento", "amostras", "vidaUtilPrevistaAnos", "vidaUtilContabilAnos", "r2", "confianca", "coeficienteAngular", "intercepto", "limiarInservivel", "conclusao"],
    },
    VIDA_UTIL_INVENTARIO: {
        campo: "equipamentos",
        colunas: ["identificador", "tipo", "marca", "modelo", "anoFabricacao", "idadeAnos", "vidaUtilPrevistaAnos", "anosRestantes", "anoPrevistoInservivel", "situacao"],
    },
};

// O arquivo é montado na hora a partir do resultado guardado no banco: não há arquivo
// em disco para guardar, apagar ou perder (e funciona com vários servidores).
export function exportar(relatorio: { id: string; tipo: TipoRelatorio; status: string; resultado: unknown }, formato: "json" | "csv") {
    if (relatorio.status !== "CONCLUIDO") {
        throw new ErroApp(`O relatório ainda não está pronto (status ${relatorio.status})`, 409);
    }

    const nome = `relatorio-${relatorio.tipo.toLowerCase()}-${relatorio.id}`;
    const resultado = relatorio.resultado as Record<string, unknown>;

    if (formato === "csv") {
        const tabela = TABELAS_DO_CSV[relatorio.tipo];
        const linhas = (resultado[tabela.campo] ?? []) as Record<string, unknown>[];
        return { conteudo: paraCsv(linhas, tabela.colunas), tipoConteudo: "text/csv; charset=utf-8", nomeArquivo: `${nome}.csv` };
    }

    return { conteudo: JSON.stringify(resultado, null, 2), tipoConteudo: "application/json; charset=utf-8", nomeArquivo: `${nome}.json` };
}
