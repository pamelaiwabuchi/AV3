import { executarTransacao } from "../lib/transacao.js";
import type { Transacao } from "../lib/transacao.js";
import { ErroConflito, ErroNaoEncontrado, ErroRegraNegocio } from "../errors/erros.js";
import { hojeSemHora } from "../utils/datas.js";
import * as loteRepository from "../repositories/loteRepository.js";
import * as equipamentoRepository from "../repositories/equipamentoRepository.js";
import * as organizacaoRepository from "../repositories/organizacaoRepository.js";
import * as parametrosRepository from "../repositories/parametrosRepository.js";
import * as movimentacaoService from "./movimentacaoService.js";
import { validarAnoFabricacao } from "./equipamentoService.js";
import type { DadosEdicaoLote, DadosLote, FiltrosLote } from "../repositories/loteRepository.js";
import type { StatusLote } from "../generated/prisma/enums.js";
import type { DadosEquipamentoNovo } from "../repositories/equipamentoRepository.js";

const DIAS_MAXIMOS_ENTRADA = 90;

// Status em que o lote ainda pode ser editado ou cancelado (a triagem não começou).
const STATUS_EDITAVEIS: StatusLote[] = ["AGUARDANDO_RECEBIMENTO", "RECEBIDO"];
const UM_DIA = 24 * 60 * 60 * 1000;

async function buscarOuFalhar(id: string) {
    const lote = await loteRepository.buscarLotePorId(id);

    if (!lote) {
        throw new ErroNaoEncontrado("Lote não encontrado");
    }

    return lote;
}

function garantirAtualizou(atualizou: boolean) {
    if (!atualizou) {
        throw new ErroConflito("O lote foi alterado por outra pessoa. Recarregue e tente de novo");
    }
}

async function validarOrganizacao(organizacaoId: string) {
    const organizacao = await organizacaoRepository.buscarOrganizacaoPorId(organizacaoId);

    if (!organizacao || !organizacao.ativo) {
        throw new ErroRegraNegocio("Organização não encontrada ou desativada");
    }

    const temContrato = await organizacaoRepository.temContratoVigente(organizacaoId);

    if (!temContrato) {
        throw new ErroRegraNegocio("A organização não tem contrato vigente");
    }
}

async function garantirNotaFiscalLivre(organizacaoId: string, notaFiscal: string, ignorarId: string | null) {
    const repetido = await loteRepository.buscarNotaFiscalRepetida(organizacaoId, notaFiscal, ignorarId);

    if (repetido) {
        throw new ErroConflito(`Esta organização já tem um lote com a nota fiscal ${notaFiscal}`);
    }
}

function validarDataEntrada(dataEntrada: Date) {
    const hoje = hojeSemHora();
    const limite = new Date(hoje.getTime() - DIAS_MAXIMOS_ENTRADA * UM_DIA);

    if (dataEntrada > hoje) {
        throw new ErroRegraNegocio("A data de entrada não pode ser no futuro");
    }

    if (dataEntrada < limite) {
        throw new ErroRegraNegocio(`A data de entrada não pode ser de mais de ${DIAS_MAXIMOS_ENTRADA} dias atrás`);
    }
}

function validarEquipamentosNovos(equipamentos: DadosEquipamentoNovo[]) {
    for (const equipamento of equipamentos) {
        validarAnoFabricacao(equipamento.anoFabricacao);
    }
}

// Formato GC-AAAA-000001: prefixo da empresa, ano do cadastro e número sequencial.
function montarCodigoDeBarras(numero: number) {
    const ano = new Date().getFullYear();
    return `GC-${ano}-${String(numero).padStart(6, "0")}`;
}

async function adicionarNoLote(tx: Transacao, loteId: string, posicao: number, dados: DadosEquipamentoNovo, idUsuario: string, observacaoEntrada?: string) {
    const codigo = montarCodigoDeBarras(await equipamentoRepository.proximoNumeroDeCodigo(tx));
    const equipamento = await equipamentoRepository.criarEquipamento(tx, loteId, posicao, codigo, dados);
    await movimentacaoService.registrarEntrada(tx, equipamento.id, idUsuario, observacaoEntrada);
}

export async function listar(pagina: number, filtros: FiltrosLote) {
    return loteRepository.listarLotes(pagina, filtros);
}

export async function listarParados() {
    const parametros = await parametrosRepository.buscarParametros();
    const dataLimite = new Date(hojeSemHora().getTime() - parametros.diasLoteParado * UM_DIA);

    return loteRepository.listarLotesParados(dataLimite);
}

export async function buscar(id: string) {
    const lote = await buscarOuFalhar(id);
    let pesoTotalKg = 0;

    for (const equipamento of lote.equipamentos) {
        if (equipamento.statusRastreamento !== "CANCELADO") {
            pesoTotalKg = pesoTotalKg + Number(equipamento.pesoQuilogramas);
        }
    }

    return { ...lote, pesoTotalKg: Math.round(pesoTotalKg * 1000) / 1000 };
}

async function criarComEquipamentos(dados: DadosLote, equipamentos: DadosEquipamentoNovo[], idUsuario: string, observacaoEntrada?: string) {
    await validarOrganizacao(dados.organizacaoId);
    await garantirNotaFiscalLivre(dados.organizacaoId, dados.notaFiscal, null);
    validarEquipamentosNovos(equipamentos);

    const lote = await executarTransacao(idUsuario, async (tx) => {
        const novoLote = await loteRepository.criarLote(tx, dados);

        for (let i = 0; i < equipamentos.length; i++) {
            await adicionarNoLote(tx, novoLote.id, i + 1, equipamentos[i]!, idUsuario, observacaoEntrada);
        }

        return novoLote;
    });

    return buscar(lote.id);
}

// Lote registrado pelo gestor: os equipamentos já chegaram (RECEBIDO).
export async function criar(dados: DadosLote & { dataEntrada: Date }, equipamentos: DadosEquipamentoNovo[], idUsuario: string) {
    validarDataEntrada(dados.dataEntrada);
    return criarComEquipamentos(dados, equipamentos, idUsuario);
}

// Lote avisado pelo parceiro (API pública): os equipamentos ainda não chegaram.
// Fica AGUARDANDO_RECEBIMENTO, sem data de entrada, até o gestor confirmar.
export async function criarAvisoDeEnvio(dados: Omit<DadosLote, "dataEntrada">, equipamentos: DadosEquipamentoNovo[], idUsuario: string, observacaoEntrada: string) {
    const dadosDoLote = { ...dados, dataEntrada: null, statusProcessamento: "AGUARDANDO_RECEBIMENTO" as const };
    return criarComEquipamentos(dadosDoLote, equipamentos, idUsuario, observacaoEntrada);
}

export async function confirmarRecebimento(id: string, versao: number, dataEntrada: Date, idUsuario: string) {
    const lote = await buscarOuFalhar(id);

    if (lote.statusProcessamento !== "AGUARDANDO_RECEBIMENTO") {
        throw new ErroRegraNegocio(`Só é possível confirmar o recebimento de um lote AGUARDANDO_RECEBIMENTO (este está ${lote.statusProcessamento})`);
    }

    validarDataEntrada(dataEntrada);

    await executarTransacao(idUsuario, async (tx) => {
        garantirAtualizou(await loteRepository.confirmarRecebimento(tx, id, versao, dataEntrada));
    });

    return buscar(id);
}

export async function editar(id: string, versao: number, dados: Partial<DadosEdicaoLote>, idUsuario: string) {
    const lote = await buscarOuFalhar(id);

    if (!STATUS_EDITAVEIS.includes(lote.statusProcessamento)) {
        throw new ErroRegraNegocio("Só é possível editar um lote AGUARDANDO_RECEBIMENTO ou RECEBIDO");
    }

    if (dados.notaFiscal !== undefined) {
        await garantirNotaFiscalLivre(lote.organizacaoId, dados.notaFiscal, id);
    }

    await executarTransacao(idUsuario, async (tx) => {
        garantirAtualizou(await loteRepository.atualizarDadosLote(tx, id, versao, dados));
    });

    return buscar(id);
}

export async function cancelar(id: string, versao: number, idUsuario: string) {
    const lote = await buscarOuFalhar(id);

    if (!STATUS_EDITAVEIS.includes(lote.statusProcessamento)) {
        throw new ErroRegraNegocio("Só é possível cancelar um lote AGUARDANDO_RECEBIMENTO ou RECEBIDO");
    }

    await executarTransacao(idUsuario, async (tx) => {
        for (const equipamento of lote.equipamentos) {
            if (equipamento.statusRastreamento === "CANCELADO") {
                continue;
            }

            await movimentacaoService.registrarMudancaDeStatus(tx, equipamento, equipamento.versao, {
                novoStatus: "CANCELADO",
                destinoId: equipamento.destinoId,
                valorRecuperacao: null,
                observacao: "Lote cancelado",
                idUsuario,
            });
        }

        garantirAtualizou(await loteRepository.cancelarLote(tx, id, versao));
    });

    return buscar(id);
}

export async function adicionarEquipamento(loteId: string, dados: DadosEquipamentoNovo, idUsuario: string, observacaoEntrada?: string) {
    const lote = await buscarOuFalhar(loteId);

    if (lote.statusProcessamento === "CANCELADO" || lote.statusProcessamento === "FINALIZADO") {
        throw new ErroRegraNegocio(`Não é possível adicionar equipamento a um lote ${lote.statusProcessamento}`);
    }

    validarEquipamentosNovos([dados]);

    await executarTransacao(idUsuario, async (tx) => {
        const posicao = (await equipamentoRepository.buscarMaiorPosicaoDoLote(tx, loteId)) + 1;
        await adicionarNoLote(tx, loteId, posicao, dados, idUsuario, observacaoEntrada);
        await movimentacaoService.recalcularStatusLote(tx, loteId);
    });

    return buscar(loteId);
}
