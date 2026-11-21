// Chaves de API dos parceiros. Faz parte da autenticação: o JWT identifica
// pessoas (funcionários); a chave de API identifica o sistema de uma organização.
import { ErroNaoAutenticado, ErroNaoEncontrado, ErroRegraNegocio } from "../errors/erros.js";
import { executarTransacao } from "../lib/transacao.js";
import * as chaveApiRepository from "../repositories/chaveApiRepository.js";
import * as organizacaoRepository from "../repositories/organizacaoRepository.js";
import { calcularHashChave, gerarChaveApi } from "../utils/chaveApi.js";
import type { PermissaoApi } from "../generated/prisma/enums.js";

// Ao trocar a chave, a anterior ainda vale por este tempo, para o parceiro ter
// tempo de atualizar o sistema dele sem ficar fora do ar.
const HORAS_DE_TRANSICAO = 24;
const UMA_HORA = 60 * 60 * 1000;

export interface PedidoChave {
    permissoes: PermissaoApi[];
    limitePorMinuto: number | undefined;
    revogarAnteriorNaHora: boolean;
}

function limitePadrao() {
    return Number(process.env.LIMITE_API_POR_MINUTO ?? 100);
}

async function buscarOrganizacaoOuFalhar(organizacaoId: string) {
    const organizacao = await organizacaoRepository.buscarOrganizacaoPorId(organizacaoId);

    if (!organizacao) {
        throw new ErroNaoEncontrado("Organização não encontrada");
    }

    return organizacao;
}

export async function listar(organizacaoId: string) {
    await buscarOrganizacaoOuFalhar(organizacaoId);

    return chaveApiRepository.listarChavesDaOrganizacao(organizacaoId);
}

// Gera a chave nova e, na mesma transação, cuida da anterior:
// troca planejada = a anterior vale mais 24 horas; suspeita de vazamento = revogada na hora.
// A chave inteira só aparece nesta resposta; depois, só o prefixo.
export async function gerar(organizacaoId: string, pedido: PedidoChave, idUsuario: string) {
    const organizacao = await buscarOrganizacaoOuFalhar(organizacaoId);

    if (!organizacao.ativo) {
        throw new ErroRegraNegocio("Organização desativada não recebe chave de API");
    }

    const { chave, hash, prefixo } = gerarChaveApi();
    const limitePorMinuto = pedido.limitePorMinuto ?? limitePadrao();
    const fimDaTransicao = new Date(Date.now() + HORAS_DE_TRANSICAO * UMA_HORA);

    const registro = await executarTransacao(idUsuario, async (tx) => {
        await organizacaoRepository.travarOrganizacao(tx, organizacaoId);

        if (pedido.revogarAnteriorNaHora) {
            await chaveApiRepository.revogarChavesAtivas(tx, organizacaoId);
        } else {
            await chaveApiRepository.marcarExpiracaoDasAtivas(tx, organizacaoId, fimDaTransicao);
        }

        const dados = { organizacaoId, hashChave: hash, prefixo, permissoes: pedido.permissoes, limitePorMinuto };
        return chaveApiRepository.criarChave(tx, dados);
    });

    return { ...registro, chave };
}

export async function revogar(id: string, idUsuario: string) {
    const existente = await chaveApiRepository.buscarChavePorId(id);

    if (!existente) {
        throw new ErroNaoEncontrado("Chave de API não encontrada");
    }

    const revogou = await executarTransacao(idUsuario, async (tx) => {
        return chaveApiRepository.revogarChave(tx, id);
    });

    if (!revogou) {
        throw new ErroRegraNegocio("Essa chave já estava revogada");
    }

    return { ...existente, ativo: false };
}

// Confere a chave que chegou numa requisição de parceiro.
// Devolve a organização dona da chave e as permissões; se algo estiver errado, 401.
export async function autenticar(chave: string) {
    const registro = await chaveApiRepository.buscarChavePorHash(calcularHashChave(chave));

    if (!registro || !registro.ativo || !registro.organizacao.ativo) {
        throw new ErroNaoAutenticado("Chave de API inválida ou revogada");
    }

    if (registro.expiraEm && registro.expiraEm < new Date()) {
        throw new ErroNaoAutenticado("Chave de API expirada: ela foi substituída por uma nova");
    }

    return {
        organizacaoId: registro.organizacao.id,
        razaoSocial: registro.organizacao.razaoSocial,
        prefixo: registro.prefixo,
        permissoes: registro.permissoes,
        limitePorMinuto: registro.limitePorMinuto,
    };
}
