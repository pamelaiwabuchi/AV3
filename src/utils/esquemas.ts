export const esquemaId = {
    type: "object",
    required: ["id"],
    properties: {
        id: { type: "string", format: "uuid" },
    },
};

// Ids fixos do seed, já preenchidos nos exemplos do Swagger
export const ID_LOTE_EXEMPLO = "00000000-0000-4000-8000-000000001001"; // lote FINALIZADO NF-1001
export const ID_ORGANIZACAO_EXEMPLO = "00000000-0000-4000-8000-000000000001"; // TechCorp
export const ID_DEPARTAMENTO_EXEMPLO = "00000000-0000-4000-8000-000000000101"; // Comercial

// Chave de API de exemplo da TechCorp, criada pelo seed para testar a API pública.
// Serve só para desenvolvimento e demonstração: num servidor de verdade, revogue-a.
export const CHAVE_API_EXEMPLO = "gc_exemplo0techcorp0000000000000000000000000000000000000000000000";

// Conta de serviço: usuário que representa a API pública nas movimentações e na
// auditoria. Fica desativada, então ninguém consegue fazer login com ela.
export const LOGIN_CONTA_SERVICO = "api.parceiros";

export function esquemaIdComExemplo(idExemplo: string) {
    return {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", format: "uuid", examples: [idExemplo] },
        },
    };
}

export const textoObrigatorio = { type: "string", minLength: 1 };
