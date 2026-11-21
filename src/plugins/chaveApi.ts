// Conferência da chave de API nas rotas públicas (/api/v1/public).
// É o "irmão" do exigirPapel (autenticacao.ts): lá o JWT identifica um funcionário,
// aqui o cabeçalho x-api-key identifica o sistema de uma organização parceira.
import type { FastifyRequest } from "fastify";
import type { PermissaoApi } from "../generated/prisma/enums.js";
import { ErroNaoAutenticado, ErroSemPermissao } from "../errors/erros.js";
import * as chaveApiService from "../services/chaveApiService.js";

export interface Parceiro {
    organizacaoId: string;
    razaoSocial: string;
    prefixo: string;
    permissoes: PermissaoApi[];
    limitePorMinuto: number;
}

declare module "fastify" {
    interface FastifyRequest {
        parceiro: Parceiro;
    }
}

export const CABECALHO_CHAVE = "x-api-key";

// Lê a chave do cabeçalho. Se vier repetida, o Fastify entrega uma lista: usa a primeira.
export function lerChave(request: FastifyRequest) {
    const valor = request.headers[CABECALHO_CHAVE];

    if (Array.isArray(valor)) {
        return valor[0];
    }

    return valor;
}

// Sem permissao (null): basta a chave ser válida.
export function exigirChave(permissao: PermissaoApi | null) {
    return async (request: FastifyRequest) => {
        const chave = lerChave(request);

        if (!chave) {
            throw new ErroNaoAutenticado(`Envie a chave de API no cabeçalho ${CABECALHO_CHAVE}`);
        }

        request.parceiro = await chaveApiService.autenticar(chave);

        if (permissao && !request.parceiro.permissoes.includes(permissao)) {
            throw new ErroSemPermissao(`Esta chave de API não tem a permissão ${permissao}`);
        }
    };
}
