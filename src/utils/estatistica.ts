// Funções de estatística usadas pelos relatórios analíticos.
// A biblioteca simple-statistics faz as contas (média, mediana, desvio padrão,
// percentil e regressão linear por mínimos quadrados); aqui só organizamos o resultado.
import { linearRegression, linearRegressionLine, max, mean, median, min, quantile, rSquared, standardDeviation } from "simple-statistics";

export function arredondar(valor: number, casas = 2) {
    const fator = 10 ** casas;
    return Math.round(valor * fator) / fator;
}

// Resumo de uma lista de números. Lista vazia devolve tudo zerado (relatório sem dados).
export function resumir(valores: number[]) {
    if (valores.length === 0) {
        return { quantidade: 0, media: 0, mediana: 0, desvioPadrao: 0, minimo: 0, maximo: 0, percentil90: 0 };
    }

    return {
        quantidade: valores.length,
        media: arredondar(mean(valores)),
        mediana: arredondar(median(valores)),
        desvioPadrao: arredondar(standardDeviation(valores)),
        minimo: arredondar(min(valores)),
        maximo: arredondar(max(valores)),
        percentil90: arredondar(quantile(valores, 0.9)),
    };
}

// Reta que melhor passa pelos pontos (mínimos quadrados): y = intercepto + coeficienteAngular × x.
// R² vai de 0 a 1: quanto mais perto de 1, mais a reta explica os pontos.
// Precisa de pelo menos 2 valores diferentes de x; senão não existe reta (devolve null).
export function regressaoLinear(pontos: [number, number][]) {
    const valoresDeX = new Set(pontos.map(([x]) => x));

    if (pontos.length < 2 || valoresDeX.size < 2) {
        return null;
    }

    const { m, b } = linearRegression(pontos);
    const r2 = rSquared(pontos, linearRegressionLine({ m, b }));

    return { coeficienteAngular: m, intercepto: b, r2 };
}

// Agrupa itens por uma chave (ex.: por tipo de equipamento).
export function agrupar<T>(itens: T[], chaveDe: (item: T) => string) {
    const grupos = new Map<string, T[]>();

    for (const item of itens) {
        const chave = chaveDe(item);
        const grupo = grupos.get(chave) ?? [];
        grupo.push(item);
        grupos.set(chave, grupo);
    }

    return grupos;
}
