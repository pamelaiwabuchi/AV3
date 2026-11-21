// Falhas (defeitos) encontradas nos equipamentos. Alimentam a previsão de vida útil.
import type { StatusRastreamento } from "../generated/prisma/enums.js";
import { ErroConflito, ErroNaoEncontrado, ErroRegraNegocio } from "../errors/erros.js";
import { executarTransacao } from "../lib/transacao.js";
import * as equipamentoRepository from "../repositories/equipamentoRepository.js";
import * as falhaRepository from "../repositories/falhaRepository.js";
import type { DadosFalha, FiltrosFalha } from "../repositories/falhaRepository.js";

// É na triagem e no desmonte que o gestor examina o equipamento e encontra os defeitos.
const STATUS_QUE_ACEITAM_FALHA: StatusRastreamento[] = ["EM_TRIAGEM", "AGUARDANDO_DESMONTE", "EM_DESMONTE"];

async function buscarEquipamentoOuFalhar(equipamentoId: string) {
    const equipamento = await equipamentoRepository.buscarEquipamentoPorId(equipamentoId);

    if (!equipamento) {
        throw new ErroNaoEncontrado("Equipamento não encontrado");
    }

    return equipamento;
}

export async function listar(pagina: number, filtros: FiltrosFalha) {
    return falhaRepository.listarFalhas(pagina, filtros);
}

export async function listarDoEquipamento(equipamentoId: string) {
    await buscarEquipamentoOuFalhar(equipamentoId);
    return falhaRepository.listarFalhasDoEquipamento(equipamentoId);
}

export async function registrar(dados: DadosFalha) {
    const equipamento = await buscarEquipamentoOuFalhar(dados.equipamentoId);

    if (!STATUS_QUE_ACEITAM_FALHA.includes(equipamento.statusRastreamento)) {
        throw new ErroRegraNegocio(`Falhas são registradas na triagem ou no desmonte (este equipamento está ${equipamento.statusRastreamento})`);
    }

    if (dados.tipo === "OUTRO" && !dados.descricao) {
        throw new ErroRegraNegocio("Para o tipo OUTRO, descreva a falha no campo descricao");
    }

    return executarTransacao(dados.responsavelId, async (tx) => {
        return falhaRepository.criarFalha(tx, dados);
    });
}

export async function anular(id: string, versao: number, justificativa: string, idUsuario: string) {
    const falha = await falhaRepository.buscarFalhaPorId(id);

    if (!falha) {
        throw new ErroNaoEncontrado("Falha não encontrada");
    }

    if (falha.anulada) {
        throw new ErroRegraNegocio("Esta falha já foi anulada");
    }

    const anulou = await executarTransacao(idUsuario, async (tx) => {
        return falhaRepository.anularFalha(tx, id, versao, justificativa);
    });

    if (!anulou) {
        throw new ErroConflito("A falha foi alterada por outra pessoa. Recarregue e tente de novo");
    }

    return falhaRepository.buscarFalhaPorId(id);
}
