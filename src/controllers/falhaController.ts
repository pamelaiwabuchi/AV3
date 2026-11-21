import type { FastifyInstance } from "fastify";
import * as falhaService from "../services/falhaService.js";
import { exigirPapel } from "../plugins/autenticacao.js";
import { esquemaId, textoObrigatorio } from "../utils/esquemas.js";
import { GravidadeFalha, TipoEquipamento, TipoFalha } from "../generated/prisma/enums.js";
import { filtroDePeriodo } from "../utils/datas.js";
import type { FiltrosFalha } from "../repositories/falhaRepository.js";

interface ParametrosId {
    id: string;
}

interface CorpoRegistrar {
    tipo: TipoFalha;
    gravidade: GravidadeFalha;
    descricao?: string;
}

interface CorpoAnular {
    justificativa: string;
    versao: number;
}

interface ConsultaLista {
    pagina: number;
    tipo?: TipoFalha;
    gravidade?: GravidadeFalha;
    tipoEquipamento?: TipoEquipamento;
    incluirAnuladas: boolean;
    inicio?: string;
    fim?: string;
}

const esquemaRegistrar = {
    params: esquemaId,
    body: {
        type: "object",
        required: ["tipo", "gravidade"],
        additionalProperties: false,
        properties: {
            tipo: { type: "string", enum: Object.values(TipoFalha) },
            gravidade: { type: "string", enum: Object.values(GravidadeFalha) },
            descricao: textoObrigatorio,
        },
    },
};

const esquemaAnular = {
    params: esquemaId,
    body: {
        type: "object",
        required: ["justificativa", "versao"],
        additionalProperties: false,
        properties: {
            justificativa: textoObrigatorio,
            versao: { type: "integer" },
        },
    },
};

const esquemaListar = {
    querystring: {
        type: "object",
        properties: {
            pagina: { type: "integer", minimum: 1, default: 1 },
            tipo: { type: "string", enum: Object.values(TipoFalha) },
            gravidade: { type: "string", enum: Object.values(GravidadeFalha) },
            tipoEquipamento: { type: "string", enum: Object.values(TipoEquipamento) },
            incluirAnuladas: { type: "boolean", default: false },
            inicio: { type: "string", format: "date" },
            fim: { type: "string", format: "date" },
        },
    },
};

const podeConsultar = exigirPapel("GESTOR_ALMOXARIFADO", "OPERADOR_CADASTRO", "AUDITOR");
const podeAlterar = exigirPapel("GESTOR_ALMOXARIFADO");

function montarFiltros(consulta: ConsultaLista) {
    const filtros: FiltrosFalha = {};

    if (!consulta.incluirAnuladas) {
        filtros.anulada = false;
    }

    if (consulta.tipo) {
        filtros.tipo = consulta.tipo;
    }

    if (consulta.gravidade) {
        filtros.gravidade = consulta.gravidade;
    }

    if (consulta.tipoEquipamento) {
        filtros.equipamento = { tipo: consulta.tipoEquipamento };
    }

    if (consulta.inicio || consulta.fim) {
        filtros.dataRegistro = filtroDePeriodo(consulta.inicio, consulta.fim);
    }

    return filtros;
}

export async function falhaController(app: FastifyInstance) {
    app.get<{ Querystring: ConsultaLista }>("/falhas", { schema: esquemaListar, onRequest: podeConsultar }, async (request) => {
        return falhaService.listar(request.query.pagina, montarFiltros(request.query));
    });

    app.get<{ Params: ParametrosId }>("/equipamentos/:id/falhas", { schema: { params: esquemaId }, onRequest: podeConsultar }, async (request) => {
        return falhaService.listarDoEquipamento(request.params.id);
    });

    app.post<{ Params: ParametrosId; Body: CorpoRegistrar }>("/equipamentos/:id/falhas", { schema: esquemaRegistrar, onRequest: podeAlterar }, async (request, reply) => {
        const { tipo, gravidade, descricao } = request.body;
        const dados = { equipamentoId: request.params.id, tipo, gravidade, descricao: descricao ?? null, responsavelId: request.user.id };

        const falha = await falhaService.registrar(dados);
        return reply.status(201).send(falha);
    });

    app.post<{ Params: ParametrosId; Body: CorpoAnular }>("/falhas/:id/anular", { schema: esquemaAnular, onRequest: podeAlterar }, async (request) => {
        const { justificativa, versao } = request.body;
        return falhaService.anular(request.params.id, versao, justificativa, request.user.id);
    });
}
