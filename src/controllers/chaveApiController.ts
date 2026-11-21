import type { FastifyInstance } from "fastify";
import * as chaveApiService from "../services/chaveApiService.js";
import { exigirPapel } from "../plugins/autenticacao.js";
import { esquemaId, esquemaIdComExemplo, ID_ORGANIZACAO_EXEMPLO } from "../utils/esquemas.js";
import { PermissaoApi } from "../generated/prisma/enums.js";

interface ParametrosId {
    id: string;
}

interface CorpoGerar {
    permissoes: PermissaoApi[];
    limitePorMinuto?: number;
    revogarAnteriorNaHora: boolean;
}

const esquemaGerar = {
    params: esquemaIdComExemplo(ID_ORGANIZACAO_EXEMPLO),
    body: {
        type: "object",
        required: ["permissoes"],
        additionalProperties: false,
        properties: {
            permissoes: {
                type: "array",
                minItems: 1,
                uniqueItems: true,
                items: { type: "string", enum: Object.values(PermissaoApi) },
            },
            // Sem limite informado, vale LIMITE_API_POR_MINUTO do .env (padrão 100).
            limitePorMinuto: { type: "integer", minimum: 1, maximum: 100000 },
            // true quando há suspeita de vazamento: a chave anterior para na hora.
            revogarAnteriorNaHora: { type: "boolean", default: false },
        },
    },
};

const podeConsultar = exigirPapel("OPERADOR_CADASTRO", "AUDITOR");
const podeAlterar = exigirPapel("OPERADOR_CADASTRO");

export async function chaveApiController(app: FastifyInstance) {
    const opcoesListar = { schema: { params: esquemaIdComExemplo(ID_ORGANIZACAO_EXEMPLO) }, onRequest: podeConsultar };
    const opcoesGerar = { schema: esquemaGerar, onRequest: podeAlterar };
    const opcoesRevogar = { schema: { params: esquemaId }, onRequest: podeAlterar };

    app.get<{ Params: ParametrosId }>("/organizacoes/:id/chaves-api", opcoesListar, async (request) => {
        return chaveApiService.listar(request.params.id);
    });

    app.post<{ Params: ParametrosId; Body: CorpoGerar }>("/organizacoes/:id/chaves-api", opcoesGerar, async (request, reply) => {
        const { permissoes, limitePorMinuto, revogarAnteriorNaHora } = request.body;
        const pedido = { permissoes, limitePorMinuto, revogarAnteriorNaHora };

        const chave = await chaveApiService.gerar(request.params.id, pedido, request.user.id);
        return reply.status(201).send(chave);
    });

    app.post<{ Params: ParametrosId }>("/chaves-api/:id/revogar", opcoesRevogar, async (request) => {
        return chaveApiService.revogar(request.params.id, request.user.id);
    });
}
