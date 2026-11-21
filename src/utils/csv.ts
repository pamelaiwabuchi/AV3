// Monta um arquivo CSV a partir de uma lista de objetos (uma linha por objeto).
// Separador ";" e marca BOM no início: é assim que o Excel em português abre o arquivo
// já em colunas e com os acentos certos.
const SEPARADOR = ";";
const BOM = "﻿";

// { valor: { media: 10 } } vira { "valor.media": 10 }: o CSV só tem uma "camada" de colunas.
function achatar(objeto: Record<string, unknown>, prefixo = ""): Record<string, unknown> {
    const resultado: Record<string, unknown> = {};

    for (const [chave, valor] of Object.entries(objeto)) {
        const nome = prefixo ? `${prefixo}.${chave}` : chave;

        if (valor !== null && typeof valor === "object" && !Array.isArray(valor)) {
            Object.assign(resultado, achatar(valor as Record<string, unknown>, nome));
        } else {
            resultado[nome] = valor;
        }
    }

    return resultado;
}

// Números com vírgula decimal (padrão brasileiro); texto com ; ou aspas vai entre aspas.
function formatarCelula(valor: unknown) {
    if (valor === null || valor === undefined) {
        return "";
    }

    const texto = typeof valor === "number" ? String(valor).replace(".", ",") : String(valor);

    if (/[;"\n]/.test(texto)) {
        return `"${texto.replaceAll('"', '""')}"`;
    }

    return texto;
}

// colunasPrimeiro: colunas que vêm na frente, nessa ordem (o banco guarda o JSON com as
// chaves fora de ordem). As que sobrarem vêm depois.
export function paraCsv(linhas: Record<string, unknown>[], colunasPrimeiro: string[] = []) {
    const achatadas = linhas.map((linha) => achatar(linha));
    const encontradas = new Set(achatadas.flatMap((linha) => Object.keys(linha)));
    const colunas = [...new Set([...colunasPrimeiro, ...encontradas])];
    const cabecalho = colunas.join(SEPARADOR);
    const corpo = achatadas.map((linha) => colunas.map((coluna) => formatarCelula(linha[coluna])).join(SEPARADOR));

    return BOM + [cabecalho, ...corpo].join("\n");
}
