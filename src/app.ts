import Fastify from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "./generated/prisma/client.js";
import { ErroApp } from "./errors/erros.js";
import { mensagemEmPortugues } from "./errors/traducaoErros.js";
import { registrarJwt } from "./plugins/autenticacao.js";
import { registrarDocumentacao } from "./plugins/documentacao.js";
import { authController } from "./controllers/authController.js";
import { usuarioController } from "./controllers/usuarioController.js";
import { organizacaoController } from "./controllers/organizacaoController.js";
import { contratoController } from "./controllers/contratoController.js";
import { destinoController } from "./controllers/destinoController.js";
import { departamentoController } from "./controllers/departamentoController.js";
import { loteController } from "./controllers/loteController.js";
import { equipamentoController } from "./controllers/equipamentoController.js";
import { movimentacaoController } from "./controllers/movimentacaoController.js";
import { auditoriaController } from "./controllers/auditoriaController.js";
import { relatorioController } from "./controllers/relatorioController.js";
import { certificadoController } from "./controllers/certificadoController.js";
import { chaveApiController } from "./controllers/chaveApiController.js";
import { publicoController } from "./controllers/publicoController.js";
import { falhaController } from "./controllers/falhaController.js";
import { analiseController } from "./controllers/analiseController.js";
import { PREFIXO_INTERNO, PREFIXO_PUBLICO, VERSAO_API } from "./utils/prefixos.js";

function tratarErro(erro: FastifyError, request: FastifyRequest, reply: FastifyReply) {
    if (erro instanceof ErroApp) {
        return reply.status(erro.statusCode).send({ erro: erro.message });
    }

    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
        return reply.status(409).send({ erro: "Já existe um registro com esse valor, que precisa ser único" });
    }

    if (erro.statusCode !== undefined && erro.statusCode < 500) {
        return reply.status(erro.statusCode).send({ erro: mensagemEmPortugues(erro) });
    }

    request.log.error(erro);
    return reply.status(500).send({ erro: "Erro interno do servidor" });
}

export function criarApp() {
    const app = Fastify({ logger: true });

    app.setErrorHandler(tratarErro);
    registrarJwt(app);
    registrarDocumentacao(app);

    app.register(async (sistema) => {
        sistema.get("/health", async () => {
            return { status: "ok" };
        });

        sistema.get("/", async (request, reply) => {   
            return reply.redirect("/docs");            
        });                                            
    });


    app.register(rotasInternas, { prefix: PREFIXO_INTERNO });
    app.register(rotasPublicas, { prefix: PREFIXO_PUBLICO });

    return app;
}

// Toda resposta da API diz a versão exata (ex.: 1.0.0) no cabeçalho api-version.
function informarVersao(app: FastifyInstance) {
    app.addHook("onSend", async (request, reply) => {
        reply.header("api-version", VERSAO_API);
    });
}

// Rotas dos funcionários. Todas ficam debaixo de /api/v1/internal.
async function rotasInternas(app: FastifyInstance) {
    informarVersao(app);
    app.register(authController);
    app.register(usuarioController);
    app.register(departamentoController);
    app.register(organizacaoController);
    app.register(contratoController);
    app.register(destinoController);
    app.register(loteController);
    app.register(equipamentoController);
    app.register(falhaController);
    app.register(movimentacaoController);
    app.register(auditoriaController);
    app.register(relatorioController);
    app.register(analiseController);
    app.register(certificadoController);
    app.register(chaveApiController);
}

// Rotas dos parceiros (chave de API). Só elas têm limite de requisições por minuto.
// O limite vem da chave (o operador define ao gerar, conforme o contrato) e é contado
// por organização: durante a troca de chave, a antiga e a nova somam no mesmo limite.
// hook "preHandler": o limite é contado depois da conferência da chave (onRequest),
// quando já se sabe de quem é a chave e qual é o limite dela. Quem passa do limite recebe 429.
async function rotasPublicas(app: FastifyInstance) {
    informarVersao(app);
    const limitePadrao = Number(process.env.LIMITE_API_POR_MINUTO ?? 100);

    await app.register(fastifyRateLimit, {
        hook: "preHandler",
        timeWindow: "1 minute",
        // Sem parceiro só acontece em rota inexistente (404): aí vale o limite padrão, por IP.
        max: (request) => request.parceiro?.limitePorMinuto ?? limitePadrao,
        keyGenerator: (request) => request.parceiro?.organizacaoId ?? request.ip,
        errorResponseBuilder: (request, contexto) => {
            const segundos = Math.ceil(contexto.ttl / 1000);
            return new ErroApp(`Limite de ${contexto.max} requisições por minuto atingido. Tente de novo em ${segundos} segundos`, 429);
        },
    });

    app.register(publicoController);
}
