// Rotas internas da camada analítica: gerar e consultar os relatórios guardados.
import type { FastifyInstance, FastifyRequest } from "fastify";
import * as relatorioAnaliticoService from "../services/relatorioAnaliticoService.js";
import { exigirLogin } from "../plugins/autenticacao.js";
import { ErroNaoEncontrado, ErroSemPermissao } from "../errors/erros.js";
import { esquemaId } from "../utils/esquemas.js";
import { StatusRelatorio, TipoRelatorio } from "../generated/prisma/enums.js";
import type { PapelUsuario } from "../generated/prisma/enums.js";

interface ParametrosId {
    id: string;
}

interface CorpoGerar {
    tipo: "EFICIENCIA" | "RENTABILIDADE" | "VIDA_UTIL";
    inicio?: string;
    fim?: string;
    organizacaoId?: string;
}

interface ConsultaLista {
    pagina: number;
    tipo?: TipoRelatorio;
    status?: StatusRelatorio;
}

// Quem vê cada relatório (o ADMINISTRADOR vê todos).
// Rentabilidade é informação financeira, como o relatório financeiro: só AUDITOR.
const PAPEIS_POR_TIPO: Record<TipoRelatorio, PapelUsuario[]> = {
    EFICIENCIA: ["GESTOR_ALMOXARIFADO", "AUDITOR"],
    RENTABILIDADE: ["AUDITOR"],
    VIDA_UTIL: ["GESTOR_ALMOXARIFADO", "OPERADOR_CADASTRO", "AUDITOR"],
    VIDA_UTIL_INVENTARIO: ["OPERADOR_CADASTRO", "AUDITOR"],
};

function tiposPermitidos(papel: PapelUsuario) {
    const todos = Object.values(TipoRelatorio);

    if (papel === "ADMINISTRADOR") {
        return todos;
    }

    return todos.filter((tipo) => PAPEIS_POR_TIPO[tipo].includes(papel));
}

function exigirTipoPermitido(request: FastifyRequest, tipo: TipoRelatorio) {
    if (!tiposPermitidos(request.user.papel).includes(tipo)) {
        throw new ErroSemPermissao(`Seu papel não pode ver relatórios de ${tipo}`);
    }
}

const esquemaGerar = {
    body: {
        type: "object",
        required: ["tipo"],
        additionalProperties: false,
        properties: {
            tipo: { type: "string", enum: ["EFICIENCIA", "RENTABILIDADE", "VIDA_UTIL"] },
            // Período (eficiência e rentabilidade). Sem informar: os últimos 12 meses.
            inicio: { type: "string", format: "date" },
            fim: { type: "string", format: "date" },
            // Só os lotes/equipamentos de uma organização (opcional).
            organizacaoId: { type: "string", format: "uuid" },
        },
    },
};

const esquemaListar = {
    querystring: {
        type: "object",
        properties: {
            pagina: { type: "integer", minimum: 1, default: 1 },
            tipo: { type: "string", enum: Object.values(TipoRelatorio) },
            status: { type: "string", enum: Object.values(StatusRelatorio) },
        },
    },
};

export async function analiseController(app: FastifyInstance) {
    app.post<{ Body: CorpoGerar }>("/relatorios/analiticos", { schema: esquemaGerar, onRequest: exigirLogin }, async (request, reply) => {
        const { tipo, inicio, fim, organizacaoId } = request.body;
        exigirTipoPermitido(request, tipo);

        const pedido = {
            tipo,
            origem: "INTERNO" as const,
            solicitadoPorId: request.user.id,
            ...(inicio ? { inicio: new Date(inicio) } : {}),
            ...(fim ? { fim: new Date(fim) } : {}),
            ...(organizacaoId ? { organizacaoId } : {}),
        };

        const relatorio = await relatorioAnaliticoService.gerarAgora(pedido);
        return reply.status(201).send(relatorio);
    });

    app.get<{ Querystring: ConsultaLista }>("/relatorios/analiticos", { schema: esquemaListar, onRequest: exigirLogin }, async (request) => {
        const permitidos = tiposPermitidos(request.user.papel);
        const tipos = request.query.tipo ? permitidos.filter((tipo) => tipo === request.query.tipo) : permitidos;
        const filtros = { tipo: { in: tipos }, ...(request.query.status ? { status: request.query.status } : {}) };

        return relatorioAnaliticoService.listar(request.query.pagina, filtros);
    });

    app.get<{ Params: ParametrosId }>("/relatorios/analiticos/:id", { schema: { params: esquemaId }, onRequest: exigirLogin }, async (request) => {
        const relatorio = await relatorioAnaliticoService.buscar(request.params.id);

        // Relatório de um tipo que o papel não vê: responde como se não existisse.
        if (!tiposPermitidos(request.user.papel).includes(relatorio.tipo)) {
            throw new ErroNaoEncontrado("Relatório não encontrado");
        }

        return relatorio;
    });
}
