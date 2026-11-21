import fastifySwagger from "@fastify/swagger";
import type { SwaggerTransformObject } from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance, RouteOptions } from "fastify";
import { exemplos, grupoDaRota, grupos, resumos } from "./descricaoRotas.js";
import { PREFIXO_INTERNO, PREFIXO_PUBLICO, VERSAO_API } from "../utils/prefixos.js";
import { CHAVE_API_EXEMPLO } from "../utils/esquemas.js";
import { DESCRICOES_DOS_CAMPOS, descreverCampos, respostasDaRota } from "./respostasApi.js";

interface Operacao {
    responses?: Record<string, unknown>;
    parameters?: { name: string; description?: string }[];
    requestBody?: { content?: Record<string, { schema?: Parameters<typeof descreverCampos>[0] }> };
}

interface DocumentoOpenApi {
    paths?: Record<string, Record<string, Operacao>>;
}

// Descrição de cada parâmetro (caminho e consulta) e de cada campo do corpo.
function descreverParametros(operacao: Operacao) {
    for (const parametro of operacao.parameters ?? []) {
        const descricao = DESCRICOES_DOS_CAMPOS[parametro.name];

        if (!parametro.description && descricao) {
            parametro.description = descricao;
        }
    }

    descreverCampos(operacao.requestBody?.content?.["application/json"]?.schema);
}

// Depois que o Swagger monta o documento, acrescenta em cada rota os exemplos de
// resposta e os códigos de erro (src/plugins/respostasApi.ts). Só muda a documentação.
const acrescentarRespostas: SwaggerTransformObject = (documento) => {
    if (!("openapiObject" in documento)) {
        return documento.swaggerObject;
    }

    const paths = (documento.openapiObject as DocumentoOpenApi).paths ?? {};

    for (const [caminho, metodos] of Object.entries(paths)) {
        const ehPublica = caminho.startsWith(PREFIXO_PUBLICO);
        const ehInterna = caminho.startsWith(PREFIXO_INTERNO);

        if (!ehPublica && !ehInterna) {
            continue;
        }

        // "/api/v1/public/lotes/{id}" vira "/public/lotes/:id", o formato de respostasApi.ts
        const curto = caminho.replace(PREFIXO_INTERNO, "").replace(PREFIXO_PUBLICO, "/public").replace(/\{(\w+)\}/g, ":$1");

        for (const [metodo, operacao] of Object.entries(metodos)) {
            const novas = respostasDaRota(metodo.toUpperCase(), curto, ehPublica);
            const temOutroSucesso = Object.keys(novas).some((codigo) => codigo.startsWith("2") && codigo !== "200");
            const respostas = { ...operacao.responses, ...novas };

            // Rota que responde 201 ou 202: tira o "200 Default Response" automático.
            if (temOutroSucesso) {
                delete respostas["200"];
            }

            operacao.responses = respostas;
            descreverParametros(operacao);
        }
    }

    return documento.openapiObject;
};

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
        transformObject: acrescentarRespostas,
        openapi: {
            info: {
                title: "AV3 - GreenCode",
                description: [
                    "API de logística reversa de equipamentos eletrônicos.",
                    "",
                    "**Rotas internas** (funcionários) ficam em `/api/v1/internal` e usam login com token. Como começar: 1) faça login em `POST /api/v1/internal/auth/login`; 2) copie o token e clique em Authorize (campo token); 3) no primeiro acesso, troque a senha provisória em `PATCH /api/v1/internal/auth/senha`; 4) faça Logout no Authorize e cole o token novo. Para editar (PATCH), consulte o registro antes: a resposta traz o campo `versao`, que precisa ir junto.",
                    "",
                    `**API pública** (parceiros) fica em \`/api/v1/public\` e usa a chave de API no cabeçalho \`x-api-key\`. Para testar, clique em Authorize e cole no campo chaveApi a chave de exemplo da TechCorp: \`${CHAVE_API_EXEMPLO}\``,
                    "",
                    "**Erros** sempre vêm como `{ \"erro\": \"mensagem em português\" }`: 400 dados inválidos, 401 sem autenticação, 403 sem permissão, 404 não encontrado (ou de outra organização), 409 conflito de versão ou valor repetido, 422 regra de negócio, 429 limite de requisições, 503 fila fora do ar.",
                    "",
                    `**Versionamento:** a versão principal está na URL (\`/v1\`) e a versão exata (${VERSAO_API}, versionamento semântico) vem no cabeçalho \`api-version\` de toda resposta. Mudanças compatíveis (rotas ou campos novos) aumentam MINOR/PATCH sem mudar a URL. Uma mudança que quebre integrações vira \`/api/v2\`; a v1 continua funcionando por pelo menos 6 meses e, nesse período, responde com os cabeçalhos \`Deprecation\` e \`Sunset\` (data de desligamento), para o parceiro migrar com calma.`,
                ].join("\n"),

                version: VERSAO_API,
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
