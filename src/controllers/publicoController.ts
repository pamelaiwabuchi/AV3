// Rotas da API pública (/api/v1/public). Quem chama é o sistema de uma organização
// parceira, com a chave no cabeçalho x-api-key. Cada rota diz qual permissão exige.
import type { FastifyInstance, FastifyReply } from "fastify";
import * as publicoService from "../services/publicoService.js";
import { exigirChave } from "../plugins/chaveApi.js";
import { esquemaId, esquemaIdComExemplo, ID_LOTE_EXEMPLO, textoObrigatorio } from "../utils/esquemas.js";
import { StatusLote } from "../generated/prisma/enums.js";
import { camposEquipamento, camposEquipamentoNovo, obrigatoriosEquipamentoNovo } from "./equipamentoController.js";
import { exigirAlgumCampo } from "../utils/alteracoes.js";
import type { DadosEdicaoLote } from "../repositories/loteRepository.js";
import type { DadosEquipamento, DadosEquipamentoNovo } from "../repositories/equipamentoRepository.js";
import type { DadosContato, PedidoDoParceiro } from "../services/publicoService.js";
import { TipoEquipamento } from "../generated/prisma/enums.js";

// Até quantos equipamentos o parceiro pode mandar num pedido de previsão do inventário.
const MAXIMO_DE_ITENS = 5000;

interface CorpoPedirRelatorio {
    tipo: PedidoDoParceiro["tipo"];
    inicio?: string;
    fim?: string;
    itens?: PedidoDoParceiro["itens"];
}

interface ConsultaPagina {
    pagina: number;
}

interface ConsultaDownload {
    formato: "json" | "csv";
}

interface CorpoWebhook {
    url: string;
}

interface ParametrosId {
    id: string;
}

interface ParametrosCodigo {
    codigo: string;
}

interface ConsultaLotes {
    pagina: number;
    status?: StatusLote;
}

interface ConsultaPeriodo {
    inicio?: string;
    fim?: string;
}

interface CorpoVersao {
    versao: number;
}

interface CorpoCriarLote {
    dataPrevistaChegada?: string;
    notaFiscal: string;
    transportadora: string;
    observacoes?: string;
    equipamentos: DadosEquipamentoNovo[];
}

interface CorpoEditarLote extends Partial<Omit<DadosEdicaoLote, "dataPrevistaChegada">> {
    dataPrevistaChegada?: string | null;
    versao: number;
}

interface CorpoEditarEquipamento extends Partial<DadosEquipamento> {
    versao: number;
}

interface CorpoEditarConta extends DadosContato {
    versao: number;
}

const anoAtual = new Date().getFullYear();

const corpoSoVersao = {
    type: "object",
    required: ["versao"],
    additionalProperties: false,
    properties: { versao: { type: "integer" } },
};

const esquemaEquipamentoNovo = {
    type: "object",
    required: obrigatoriosEquipamentoNovo,
    additionalProperties: false,
    properties: camposEquipamentoNovo,
};

const parametrosCodigo = {
    type: "object",
    required: ["codigo"],
    properties: { codigo: { type: "string", examples: [`GC-${anoAtual}-000001`] } },
};

const consultaPeriodo = {
    type: "object",
    properties: {
        inicio: { type: "string", format: "date", examples: [`${anoAtual}-01-01`] },
        fim: { type: "string", format: "date", examples: [`${anoAtual}-12-31`] },
    },
};

const esquemaEditarConta = {
    body: {
        type: "object",
        required: ["versao"],
        additionalProperties: false,
        properties: {
            telefone: textoObrigatorio,
            email: { type: "string", format: "email" },
            enderecoCompleto: textoObrigatorio,
            versao: { type: "integer" },
        },
    },
};

const esquemaListarLotes = {
    querystring: {
        type: "object",
        properties: {
            pagina: { type: "integer", minimum: 1, default: 1 },
            status: { type: "string", enum: Object.values(StatusLote) },
        },
    },
};

const esquemaCriarLote = {
    body: {
        type: "object",
        required: ["notaFiscal", "transportadora", "equipamentos"],
        additionalProperties: false,
        properties: {
            dataPrevistaChegada: { type: "string", format: "date" },
            notaFiscal: textoObrigatorio,
            transportadora: textoObrigatorio,
            observacoes: textoObrigatorio,
            equipamentos: { type: "array", minItems: 1, items: esquemaEquipamentoNovo },
        },
    },
};

const esquemaEditarLote = {
    params: esquemaId,
    body: {
        type: "object",
        required: ["versao"],
        additionalProperties: false,
        properties: {
            notaFiscal: textoObrigatorio,
            transportadora: textoObrigatorio,
            observacoes: { ...textoObrigatorio, nullable: true },
            dataPrevistaChegada: { type: "string", format: "date", nullable: true },
            versao: { type: "integer" },
        },
    },
};

const esquemaEditarEquipamento = {
    params: parametrosCodigo,
    body: {
        type: "object",
        required: ["versao"],
        additionalProperties: false,
        properties: { ...camposEquipamento, versao: { type: "integer" } },
    },
};

const esquemaPedirRelatorio = {
    body: {
        type: "object",
        required: ["tipo"],
        additionalProperties: false,
        properties: {
            // EFICIENCIA: prazos de triagem dos lotes da organização (período padrão: 12 meses).
            // VIDA_UTIL_INVENTARIO: previsão para a lista de equipamentos que a organização ainda usa.
            tipo: { type: "string", enum: ["EFICIENCIA", "VIDA_UTIL_INVENTARIO"] },
            inicio: { type: "string", format: "date" },
            fim: { type: "string", format: "date" },
            itens: {
                type: "array",
                minItems: 1,
                maxItems: MAXIMO_DE_ITENS,
                items: {
                    type: "object",
                    required: ["tipo", "anoFabricacao"],
                    additionalProperties: false,
                    properties: {
                        identificador: { type: "string", maxLength: 100 },
                        tipo: { type: "string", enum: Object.values(TipoEquipamento) },
                        marca: { type: "string", maxLength: 100 },
                        modelo: { type: "string", maxLength: 100 },
                        anoFabricacao: { type: "integer", minimum: 1950, maximum: anoAtual },
                    },
                },
            },
        },
    },
};

const esquemaPagina = {
    querystring: {
        type: "object",
        properties: { pagina: { type: "integer", minimum: 1, default: 1 } },
    },
};

const esquemaDownload = {
    params: esquemaId,
    querystring: {
        type: "object",
        properties: { formato: { type: "string", enum: ["json", "csv"], default: "json" } },
    },
};

const esquemaWebhook = {
    body: {
        type: "object",
        required: ["url"],
        additionalProperties: false,
        properties: { url: { type: "string", format: "uri", maxLength: 500 } },
    },
};

const podeLer = exigirChave("LER_RASTREABILIDADE");
const podeGerarRelatorios = exigirChave("GERAR_RELATORIOS");
const podeGerenciar = exigirChave("GERENCIAR_LOTES");
const podeAtualizarCadastro = exigirChave("ATUALIZAR_CADASTRO");

// Período padrão dos relatórios: do começo do ano até hoje.
function lerPeriodo(consulta: ConsultaPeriodo) {
    const inicio = consulta.inicio ? new Date(consulta.inicio) : new Date(Date.UTC(anoAtual, 0, 1));
    const fim = consulta.fim ? new Date(consulta.fim) : new Date();

    return { inicio, fim };
}

function enviarPdf(reply: FastifyReply, certificado: { numero: string; pdf: Buffer }) {
    return reply
        .type("application/pdf")
        .header("Content-Disposition", `attachment; filename="${certificado.numero}.pdf"`)
        .send(certificado.pdf);
}

export async function publicoController(app: FastifyInstance) {
    // Relatório pesado: responde 202 (aceito) na hora, com o id; o cálculo vai para a fila.
    app.post<{ Body: CorpoPedirRelatorio }>("/relatorios", { schema: esquemaPedirRelatorio, onRequest: podeGerarRelatorios }, async (request, reply) => {
        const { tipo, inicio, fim, itens } = request.body;
        const pedido: PedidoDoParceiro = {
            tipo,
            ...(inicio ? { inicio: new Date(inicio) } : {}),
            ...(fim ? { fim: new Date(fim) } : {}),
            ...(itens ? { itens } : {}),
        };

        const relatorio = await publicoService.pedirRelatorio(request.parceiro, pedido);
        return reply.status(202).header("Location", relatorio.links.status).send(relatorio);
    });

    app.get<{ Querystring: ConsultaPagina }>("/relatorios", { schema: esquemaPagina, onRequest: podeGerarRelatorios }, async (request) => {
        return publicoService.listarRelatorios(request.parceiro, request.query.pagina);
    });

    app.get<{ Params: ParametrosId }>("/relatorios/:id", { schema: { params: esquemaId }, onRequest: podeGerarRelatorios }, async (request) => {
        return publicoService.buscarRelatorio(request.parceiro, request.params.id);
    });

    app.get<{ Params: ParametrosId; Querystring: ConsultaDownload }>("/relatorios/:id/download", { schema: esquemaDownload, onRequest: podeGerarRelatorios }, async (request, reply) => {
        const arquivo = await publicoService.baixarRelatorio(request.parceiro, request.params.id, request.query.formato);

        return reply
            .type(arquivo.tipoConteudo)
            .header("Content-Disposition", `attachment; filename="${arquivo.nomeArquivo}"`)
            .send(arquivo.conteudo);
    });

    app.get("/webhook", { onRequest: podeAtualizarCadastro }, async (request) => {
        return publicoService.consultarWebhook(request.parceiro);
    });

    app.put<{ Body: CorpoWebhook }>("/webhook", { schema: esquemaWebhook, onRequest: podeAtualizarCadastro }, async (request) => {
        return publicoService.configurarWebhook(request.parceiro, request.body.url);
    });

    app.delete("/webhook", { onRequest: podeAtualizarCadastro }, async (request) => {
        return publicoService.removerWebhook(request.parceiro);
    });

    app.get("/conta", { onRequest: exigirChave(null) }, async (request) => {
        return publicoService.conta(request.parceiro);
    });

    app.patch<{ Body: CorpoEditarConta }>("/conta", { schema: esquemaEditarConta, onRequest: podeAtualizarCadastro }, async (request) => {
        const { versao, ...dados } = request.body;
        exigirAlgumCampo(dados);
        return publicoService.atualizarConta(request.parceiro, versao, dados);
    });

    app.get<{ Querystring: ConsultaLotes }>("/lotes", { schema: esquemaListarLotes, onRequest: podeLer }, async (request) => {
        return publicoService.listarLotes(request.parceiro, request.query.pagina, request.query.status);
    });

    app.get<{ Params: ParametrosId }>("/lotes/:id", { schema: { params: esquemaIdComExemplo(ID_LOTE_EXEMPLO) }, onRequest: podeLer }, async (request) => {
        return publicoService.buscarLote(request.parceiro, request.params.id);
    });

    app.post<{ Body: CorpoCriarLote }>("/lotes", { schema: esquemaCriarLote, onRequest: podeGerenciar }, async (request, reply) => {
        const { equipamentos, dataPrevistaChegada, observacoes, ...resto } = request.body;
        const dataPrevista = dataPrevistaChegada ? new Date(dataPrevistaChegada) : null;
        const dados = { ...resto, dataPrevistaChegada: dataPrevista, observacoes: observacoes ?? null };

        const lote = await publicoService.criarLote(request.parceiro, dados, equipamentos);
        return reply.status(201).send(lote);
    });

    app.patch<{ Params: ParametrosId; Body: CorpoEditarLote }>("/lotes/:id", { schema: esquemaEditarLote, onRequest: podeGerenciar }, async (request) => {
        const { versao, dataPrevistaChegada, ...resto } = request.body;
        const dados: Partial<DadosEdicaoLote> = { ...resto };

        if (dataPrevistaChegada !== undefined) {
            dados.dataPrevistaChegada = dataPrevistaChegada ? new Date(dataPrevistaChegada) : null;
        }

        exigirAlgumCampo(dados);
        return publicoService.editarLote(request.parceiro, request.params.id, versao, dados);
    });

    app.patch<{ Params: ParametrosId; Body: CorpoVersao }>("/lotes/:id/cancelar", { schema: { params: esquemaId, body: corpoSoVersao }, onRequest: podeGerenciar }, async (request) => {
        return publicoService.cancelarLote(request.parceiro, request.params.id, request.body.versao);
    });

    app.post<{ Params: ParametrosId; Body: DadosEquipamentoNovo }>("/lotes/:id/equipamentos", { schema: { params: esquemaId, body: esquemaEquipamentoNovo }, onRequest: podeGerenciar }, async (request, reply) => {
        const lote = await publicoService.adicionarEquipamento(request.parceiro, request.params.id, request.body);
        return reply.status(201).send(lote);
    });

    app.get<{ Params: ParametrosId }>("/lotes/:id/certificado", { schema: { params: esquemaIdComExemplo(ID_LOTE_EXEMPLO) }, onRequest: podeLer }, async (request, reply) => {
        const certificado = await publicoService.certificadoDoLote(request.parceiro, request.params.id);
        return enviarPdf(reply, certificado);
    });

    app.get<{ Params: ParametrosCodigo }>("/equipamentos/:codigo", { schema: { params: parametrosCodigo }, onRequest: podeLer }, async (request) => {
        return publicoService.buscarEquipamento(request.parceiro, request.params.codigo);
    });

    app.patch<{ Params: ParametrosCodigo; Body: CorpoEditarEquipamento }>("/equipamentos/:codigo", { schema: esquemaEditarEquipamento, onRequest: podeGerenciar }, async (request) => {
        const { versao, ...dados } = request.body;
        exigirAlgumCampo(dados);
        return publicoService.editarEquipamento(request.parceiro, request.params.codigo, versao, dados);
    });

    app.patch<{ Params: ParametrosCodigo; Body: CorpoVersao }>("/equipamentos/:codigo/cancelar", { schema: { params: parametrosCodigo, body: corpoSoVersao }, onRequest: podeGerenciar }, async (request) => {
        return publicoService.cancelarEquipamento(request.parceiro, request.params.codigo, request.body.versao);
    });

    app.get<{ Querystring: ConsultaPeriodo }>("/certificado", { schema: { querystring: consultaPeriodo }, onRequest: podeLer }, async (request, reply) => {
        const { inicio, fim } = lerPeriodo(request.query);
        const certificado = await publicoService.certificadoDoPeriodo(request.parceiro, inicio, fim);
        return enviarPdf(reply, certificado);
    });

    app.get<{ Querystring: ConsultaPeriodo }>("/resumo", { schema: { querystring: consultaPeriodo }, onRequest: podeLer }, async (request) => {
        const { inicio, fim } = lerPeriodo(request.query);
        return publicoService.resumo(request.parceiro, inicio, fim);
    });
}
