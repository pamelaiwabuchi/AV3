import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance, RouteOptions } from "fastify";
import { exemplos, grupoDaRota, grupos, resumos } from "./descricaoRotas.js";
import { PREFIXO_INTERNO, PREFIXO_PUBLICO } from "../utils/prefixos.js";
import { CHAVE_API_EXEMPLO } from "../utils/esquemas.js";

function descreverRota(rota: RouteOptions) {
    if (rota.url.startsWith("/docs")) {
        return;
    }

    // Os textos de descricaoRotas.ts usam o caminho curto: "GET /lotes" (interna)
    // e "GET /public/lotes" (pública).
    const ehPublica = rota.url.startsWith(PREFIXO_PUBLICO);
    const caminho = rota.url.replace(PREFIXO_INTERNO, "").replace(PREFIXO_PUBLICO, "/public");
    const chave = `${rota.method} ${caminho}`;
    const schema = { ...rota.schema, tags: [grupoDaRota(caminho)] };

    // Rotas públicas usam a chave de API (botão Authorize, campo chaveApi), não o token.
    if (ehPublica) {
        schema.security = [{ chaveApi: [] }];
    }

    const resumo = resumos[chave];
    const exemplo = exemplos[chave];

    if (resumo) {
        schema.summary = resumo;
    }

    if (exemplo && schema.body) {
        schema.body = { ...(schema.body as object), examples: [exemplo] };
    }

    rota.schema = schema;
}

export function registrarDocumentacao(app: FastifyInstance) {
    app.addHook("onRoute", descreverRota);

    app.register(fastifySwagger, {
        openapi: {
            info: {
                title: "AV3 - GreenCode",
                description: `API de logística reversa de equipamentos eletrônicos. Rotas internas (funcionários, login com token) ficam em /api/v1/internal. Como começar: 1) faça login em POST /api/v1/internal/auth/login; 2) copie o token e clique em Authorize; 3) no primeiro acesso, troque a senha provisória em PATCH /api/v1/internal/auth/senha; 4) clique em Authorize de novo, faça Logout e cole o token novo que veio na resposta. Para editar (PATCH), consulte o registro antes: a resposta traz o campo versao, que precisa ir junto na edição. API pública (parceiros) fica em /api/v1/public e usa a chave de API no cabeçalho x-api-key: clique em Authorize e cole no campo chaveApi a chave de exemplo da TechCorp, ${CHAVE_API_EXEMPLO}`,
                version: "1.0.0",
            },
            tags: grupos,
            components: {
                securitySchemes: {
                    token: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
                    chaveApi: { type: "apiKey", in: "header", name: "x-api-key" },
                },
            },
            security: [{ token: [] }],
        },
    });

    app.register(fastifySwaggerUi, {
        routePrefix: "/docs",
        uiConfig: { persistAuthorization: true },
        theme: { title: "AV3-GreenCode" },
    });

}
