import { createHash, randomBytes } from "node:crypto";

// Toda chave começa com "gc_" (de greencode), para ser fácil reconhecer.
const INICIO_CHAVE = "gc_";

// Quantos caracteres do começo da chave ficam guardados como prefixo ("gc_8f3a").
const TAMANHO_PREFIXO = 7;

// Calcula o hash SHA-256 da chave. É o que fica guardado no banco.
// Usado ao gerar a chave e, depois, em toda requisição de parceiro.
export function calcularHashChave(chave: string) {
    return createHash("sha256").update(chave).digest("hex");
}

// Sorteia uma chave nova e devolve as três partes:
// a chave (mostrada uma vez só), o hash e o prefixo (guardados no banco).
export function gerarChaveApi() {
    const chave = INICIO_CHAVE + randomBytes(32).toString("hex");
    const hash = calcularHashChave(chave);
    const prefixo = chave.slice(0, TAMANHO_PREFIXO);

    return { chave, hash, prefixo };
}
