// Começo do endereço de cada grupo de rotas. O "v1" é a versão da API.
// Rotas internas: usadas pelos funcionários (login com JWT).
export const PREFIXO_INTERNO = "/api/v1/internal";

// Rotas públicas: usadas pelos sistemas dos parceiros (chave de API).
export const PREFIXO_PUBLICO = "/api/v1/public";

// Versão semântica da API (MAJOR.MINOR.PATCH). Vai no cabeçalho api-version de toda resposta.
// MINOR/PATCH: só acrescenta ou corrige (não quebra integração). MAJOR: muda o prefixo para /v2.
export const VERSAO_API = "1.0.0";
