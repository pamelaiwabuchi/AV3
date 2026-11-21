// Fila de tarefas (BullMQ + Redis).
//
// Por que fila: um relatório pedido pela API pode levar vários segundos. Em vez de
// deixar o parceiro esperando (e a conexão cair), a API guarda o pedido, coloca uma
// tarefa na fila e responde na hora com o id. Um "worker" (src/workers.ts) pega a
// tarefa, calcula e guarda o resultado; o parceiro consulta o status ou recebe o webhook.
//
// O Redis guarda as tarefas: se o servidor reiniciar, nada se perde.
import { Queue } from "bullmq";

export const FILA_RELATORIOS = "relatorios";
export const FILA_WEBHOOKS = "webhooks";

// Política de tentativas (retry) dos relatórios: 3 tentativas, com espera crescente
// (1 min antes da 2ª, 2 min antes da 3ª). Cobre instabilidades rápidas (banco reiniciando,
// rede). Erros de dados (ex.: lista inválida) não são repetidos: falhariam igual.
export const TENTATIVAS_RELATORIO = 3;
const ESPERA_RELATORIO_MS = 60 * 1000;

// Webhooks: o sistema do parceiro pode estar fora do ar, então tenta mais vezes:
// 5 tentativas, esperando 30 s, 1 min, 2 min e 4 min.
export const TENTATIVAS_WEBHOOK = 5;
const ESPERA_WEBHOOK_MS = 30 * 1000;

// Relatórios automáticos: todo dia 1º, às 3h da manhã (horário de Brasília).
const TODO_DIA_1_AS_3H = "0 3 1 * *";
const FUSO = "America/Sao_Paulo";

const filas = new Map<string, Queue>();

export function conexaoRedis() {
    const url = process.env.REDIS_URL;

    if (!url) {
        throw new Error("A variável REDIS_URL não foi definida no arquivo .env");
    }

    // maxRetriesPerRequest: null é exigência do BullMQ para os workers.
    return { url, maxRetriesPerRequest: null };
}

// A fila só é criada (e o Redis só é conectado) na primeira vez que é usada.
function obterFila(nome: string) {
    let fila = filas.get(nome);

    if (!fila) {
        fila = new Queue(nome, { connection: conexaoRedis() });
        filas.set(nome, fila);
    }

    return fila;
}

// jobId = id do relatório: o mesmo relatório nunca entra duas vezes na fila.
export async function enfileirarRelatorio(relatorioId: string) {
    await obterFila(FILA_RELATORIOS).add("processar", { relatorioId }, {
        jobId: relatorioId,
        attempts: TENTATIVAS_RELATORIO,
        backoff: { type: "exponential", delay: ESPERA_RELATORIO_MS },
        removeOnComplete: 1000,
        removeOnFail: 5000,
    });
}

export async function enfileirarWebhook(relatorioId: string) {
    await obterFila(FILA_WEBHOOKS).add("avisar", { relatorioId }, {
        jobId: `webhook-${relatorioId}`,
        attempts: TENTATIVAS_WEBHOOK,
        backoff: { type: "exponential", delay: ESPERA_WEBHOOK_MS },
        removeOnComplete: 1000,
        removeOnFail: 5000,
    });
}

// Cria (ou atualiza, se já existir) o agendamento mensal de cada relatório.
// O BullMQ guarda o agendamento no Redis: mesmo com vários servidores, roda uma vez só.
export async function agendarRelatoriosMensais() {
    const fila = obterFila(FILA_RELATORIOS);

    for (const tipo of ["EFICIENCIA", "RENTABILIDADE", "VIDA_UTIL"]) {
        await fila.upsertJobScheduler(`mensal-${tipo}`, { pattern: TODO_DIA_1_AS_3H, tz: FUSO }, {
            name: "agendado",
            data: { tipo },
        });
    }
}

export async function removerTarefaDeRelatorio(relatorioId: string) {
    await obterFila(FILA_RELATORIOS).remove(relatorioId);
}

export async function fecharFilas() {
    for (const fila of filas.values()) {
        await fila.close();
    }

    filas.clear();
}
