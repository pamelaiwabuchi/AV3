// Regras da API pública (parceiros). Quase tudo reaproveita os services internos;
// o que este arquivo acrescenta é:
// 1) o parceiro só enxerga e altera os dados da própria organização (senão, 404);
// 2) o lote enviado pelo parceiro nasce AGUARDANDO_RECEBIMENTO (ainda não chegou), e o
//    parceiro só mexe nele nesse status: depois que a greencode confere, não muda mais;
// 3) as gravações ficam no nome da conta de serviço (api.parceiros);
// 4) o valor de recuperação (quanto a greencode recebeu) é segredo comercial e não sai na API.
import type { Equipamento } from "../generated/prisma/client.js";
import type { StatusLote } from "../generated/prisma/enums.js";
import { ErroNaoEncontrado, ErroRegraNegocio } from "../errors/erros.js";
import type { Parceiro } from "../plugins/chaveApi.js";
import { prisma } from "../lib/prisma.js";
import { LOGIN_CONTA_SERVICO } from "../utils/esquemas.js";
import * as loteRepository from "../repositories/loteRepository.js";
import * as falhaRepository from "../repositories/falhaRepository.js";
import * as certificadoService from "./certificadoService.js";
import * as equipamentoService from "./equipamentoService.js";
import * as loteService from "./loteService.js";
import * as organizacaoService from "./organizacaoService.js";
import * as relatorioService from "./relatorioService.js";
import * as relatorioAnaliticoService from "./relatorioAnaliticoService.js";
import * as webhookService from "./webhookService.js";
import type { ItemDoInventario } from "./analise/vidaUtilService.js";
import type { DadosEdicaoLote } from "../repositories/loteRepository.js";
import type { DadosEquipamento, DadosEquipamentoNovo } from "../repositories/equipamentoRepository.js";

export interface DadosContato {
    telefone?: string;
    email?: string;
    enderecoCompleto?: string;
}

export interface DadosLoteParceiro {
    dataPrevistaChegada: Date | null;
    notaFiscal: string;
    transportadora: string;
    observacoes: string | null;
}

// O id da conta de serviço não muda, então é buscado uma vez só e guardado aqui.
let idContaServico: string | null = null;

async function idDaContaDeServico() {
    if (idContaServico) {
        return idContaServico;
    }

    const conta = await prisma.usuario.findUnique({ where: { login: LOGIN_CONTA_SERVICO } });

    if (!conta) {
        throw new Error(`A conta de serviço "${LOGIN_CONTA_SERVICO}" não existe. Rode o seed (npx prisma db seed)`);
    }

    idContaServico = conta.id;
    return idContaServico;
}

// Tira o valorRecuperacao das respostas: o cliente não vê quanto a greencode ganhou.
function semValor<T extends { valorRecuperacao: unknown }>(equipamento: T) {
    const { valorRecuperacao, ...resto } = equipamento;
    return resto;
}

function loteSemValores<T extends { equipamentos: { valorRecuperacao: unknown }[] }>(lote: T) {
    return { ...lote, equipamentos: lote.equipamentos.map(semValor) };
}

function origem(parceiro: Parceiro) {
    return `pela API pública (chave ${parceiro.prefixo})`;
}

// Busca o lote e confere se é do parceiro. Lote de outra organização responde 404,
// como se não existisse: assim ninguém descobre ids de lotes alheios.
async function loteDoParceiro(parceiro: Parceiro, loteId: string) {
    const lote = await loteService.buscar(loteId);

    if (lote.organizacaoId !== parceiro.organizacaoId) {
        throw new ErroNaoEncontrado("Lote não encontrado");
    }

    return lote;
}

function exigirAguardandoRecebimento(statusDoLote: StatusLote) {
    if (statusDoLote !== "AGUARDANDO_RECEBIMENTO") {
        throw new ErroRegraNegocio(`O lote está ${statusDoLote}: pela API, só dá para alterar lotes que ainda não chegaram (AGUARDANDO_RECEBIMENTO). Fale com a greencode`);
    }
}

// Texto do campo "emitido por" no certificado pedido pela API. No PDF a frase fica:
// "Emitido por solicitação de TechCorp Soluções Ltda pela API pública, pelo sistema GreenCode."
function emitidoPeloSistema(parceiro: Parceiro) {
    return `solicitação de ${parceiro.razaoSocial} pela API pública`;
}

async function equipamentoDoParceiro(parceiro: Parceiro, codigo: string) {
    const equipamento = await equipamentoService.buscarPorCodigo(codigo);
    const lote = await loteRepository.buscarLotePorId(equipamento.loteId);

    if (!lote || lote.organizacaoId !== parceiro.organizacaoId) {
        throw new ErroNaoEncontrado(`Nenhum equipamento com o código ${codigo}`);
    }

    return { equipamento, statusDoLote: lote.statusProcessamento };
}

// O histórico interno traz o funcionário responsável; para o parceiro, só o que aconteceu.
async function historicoParaParceiro(equipamento: Equipamento) {
    const historico = await equipamentoService.historico(equipamento.id);

    return historico.map((item) => ({
        dataHora: item.dataHora,
        origem: item.origem,
        destino: item.destino,
        observacao: item.observacao,
    }));
}

// Laudo para o cliente: só as falhas válidas, com tipo, gravidade e data
// (a descrição é anotação interna do gestor e não sai).
async function falhasParaParceiro(equipamento: Equipamento) {
    const falhas = await falhaRepository.listarFalhasDoEquipamento(equipamento.id);

    return falhas
        .filter((falha) => !falha.anulada)
        .map((falha) => ({ tipo: falha.tipo, gravidade: falha.gravidade, dataRegistro: falha.dataRegistro }));
}

export async function conta(parceiro: Parceiro) {
    const organizacao = await organizacaoService.buscar(parceiro.organizacaoId);

    return {
        organizacao,
        chave: { prefixo: parceiro.prefixo, permissoes: parceiro.permissoes },
    };
}

export async function atualizarConta(parceiro: Parceiro, versao: number, dados: DadosContato) {
    return organizacaoService.atualizar(parceiro.organizacaoId, versao, dados, await idDaContaDeServico());
}

export async function listarLotes(parceiro: Parceiro, pagina: number, status: StatusLote | undefined) {
    const filtros: loteRepository.FiltrosLote = { organizacaoId: parceiro.organizacaoId };

    if (status) {
        filtros.statusProcessamento = status;
    }

    return loteService.listar(pagina, filtros);
}

export async function buscarLote(parceiro: Parceiro, loteId: string) {
    return loteSemValores(await loteDoParceiro(parceiro, loteId));
}

export async function criarLote(parceiro: Parceiro, dados: DadosLoteParceiro, equipamentos: DadosEquipamentoNovo[]) {
    const dadosDoLote = { ...dados, organizacaoId: parceiro.organizacaoId };
    const observacao = `Entrada no lote ${origem(parceiro)}`;

    return loteSemValores(await loteService.criarAvisoDeEnvio(dadosDoLote, equipamentos, await idDaContaDeServico(), observacao));
}

export async function editarLote(parceiro: Parceiro, loteId: string, versao: number, dados: Partial<DadosEdicaoLote>) {
    const lote = await loteDoParceiro(parceiro, loteId);
    exigirAguardandoRecebimento(lote.statusProcessamento);

    return loteSemValores(await loteService.editar(loteId, versao, dados, await idDaContaDeServico()));
}

export async function cancelarLote(parceiro: Parceiro, loteId: string, versao: number) {
    const lote = await loteDoParceiro(parceiro, loteId);
    exigirAguardandoRecebimento(lote.statusProcessamento);

    return loteSemValores(await loteService.cancelar(loteId, versao, await idDaContaDeServico()));
}

export async function adicionarEquipamento(parceiro: Parceiro, loteId: string, dados: DadosEquipamentoNovo) {
    const lote = await loteDoParceiro(parceiro, loteId);
    exigirAguardandoRecebimento(lote.statusProcessamento);

    const observacao = `Entrada no lote ${origem(parceiro)}`;
    return loteSemValores(await loteService.adicionarEquipamento(loteId, dados, await idDaContaDeServico(), observacao));
}

export async function buscarEquipamento(parceiro: Parceiro, codigo: string) {
    const { equipamento } = await equipamentoDoParceiro(parceiro, codigo);
    const historico = await historicoParaParceiro(equipamento);
    const falhas = await falhasParaParceiro(equipamento);

    return { ...semValor(equipamento), historico, falhas };
}

export async function editarEquipamento(parceiro: Parceiro, codigo: string, versao: number, dados: Partial<DadosEquipamento>) {
    const { equipamento, statusDoLote } = await equipamentoDoParceiro(parceiro, codigo);
    exigirAguardandoRecebimento(statusDoLote);

    return semValor(await equipamentoService.editar(equipamento.id, versao, dados, await idDaContaDeServico()));
}

// "Remover" um equipamento = cancelar (nada é apagado). Gera movimentação, como sempre.
export async function cancelarEquipamento(parceiro: Parceiro, codigo: string, versao: number) {
    const { equipamento, statusDoLote } = await equipamentoDoParceiro(parceiro, codigo);
    exigirAguardandoRecebimento(statusDoLote);

    const cancelado = await equipamentoService.movimentar(equipamento.id, versao, {
        novoStatus: "CANCELADO",
        destinoId: null,
        valorRecuperacao: null,
        observacao: `Cancelado ${origem(parceiro)}`,
        idUsuario: await idDaContaDeServico(),
    });

    return semValor(cancelado);
}

export async function certificadoDoLote(parceiro: Parceiro, loteId: string) {
    await loteDoParceiro(parceiro, loteId);
    return certificadoService.certificadoDoLote(loteId, await idDaContaDeServico(), emitidoPeloSistema(parceiro));
}

export async function certificadoDoPeriodo(parceiro: Parceiro, inicio: Date, fim: Date) {
    return certificadoService.certificadoDoPeriodo(parceiro.organizacaoId, inicio, fim, await idDaContaDeServico(), emitidoPeloSistema(parceiro));
}

// Resumo para o painel do parceiro: quantos lotes em cada status e para onde
// foram os equipamentos no período (reaproveita o relatório de destinação).
export async function resumo(parceiro: Parceiro, inicio: Date, fim: Date) {
    const contagem = await loteRepository.contarLotesPorStatus(parceiro.organizacaoId);
    const lotesPorStatus: Record<string, number> = {};

    for (const linha of contagem) {
        lotesPorStatus[linha.statusProcessamento] = linha._count._all;
    }

    const destinacao = await relatorioService.relatorioDestinacao(parceiro.organizacaoId, inicio, fim);

    return { lotesPorStatus, destinacao };
}

// ---------- relatórios pela API (processados na fila) ----------

export interface PedidoDoParceiro {
    tipo: "EFICIENCIA" | "VIDA_UTIL_INVENTARIO";
    inicio?: Date;
    fim?: Date;
    itens?: ItemDoInventario[];
}

function enderecos(relatorioId: string) {
    const base = `/api/v1/public/relatorios/${relatorioId}`;
    return { status: base, downloadJson: `${base}/download?formato=json`, downloadCsv: `${base}/download?formato=csv` };
}

// O parceiro vê só os relatórios que ele mesmo pediu pela API.
async function relatorioDoParceiro(parceiro: Parceiro, relatorioId: string) {
    const relatorio = await relatorioAnaliticoService.buscar(relatorioId);

    if (relatorio.organizacaoId !== parceiro.organizacaoId || relatorio.origem !== "API") {
        throw new ErroNaoEncontrado("Relatório não encontrado");
    }

    return relatorio;
}

function resumoDoPedido(relatorio: { id: string; tipo: string; status: string; dataPedido: Date; dataConclusao: Date | null; tentativas: number; erro: string | null }) {
    const { id, tipo, status, dataPedido, dataConclusao, tentativas, erro } = relatorio;
    return { id, tipo, status, dataPedido, dataConclusao, tentativas, erro, links: enderecos(id) };
}

export async function pedirRelatorio(parceiro: Parceiro, pedido: PedidoDoParceiro) {
    const relatorio = await relatorioAnaliticoService.pedirNaFila({ ...pedido, origem: "API", organizacaoId: parceiro.organizacaoId });
    return resumoDoPedido(relatorio);
}

export async function listarRelatorios(parceiro: Parceiro, pagina: number) {
    const lista = await relatorioAnaliticoService.listar(pagina, { organizacaoId: parceiro.organizacaoId, origem: "API" });
    return { ...lista, itens: lista.itens.map(resumoDoPedido) };
}

// Status do pedido; quando estiver CONCLUIDO, traz também o resultado.
export async function buscarRelatorio(parceiro: Parceiro, relatorioId: string) {
    const relatorio = await relatorioDoParceiro(parceiro, relatorioId);
    return { ...resumoDoPedido(relatorio), resultado: relatorio.resultado };
}

export async function baixarRelatorio(parceiro: Parceiro, relatorioId: string, formato: "json" | "csv") {
    return relatorioAnaliticoService.exportar(await relatorioDoParceiro(parceiro, relatorioId), formato);
}

// ---------- webhook ----------

export async function consultarWebhook(parceiro: Parceiro) {
    return webhookService.consultar(parceiro.organizacaoId);
}

export async function configurarWebhook(parceiro: Parceiro, url: string) {
    return webhookService.configurar(parceiro.organizacaoId, url, await idDaContaDeServico());
}

export async function removerWebhook(parceiro: Parceiro) {
    return webhookService.remover(parceiro.organizacaoId, await idDaContaDeServico());
}
