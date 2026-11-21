// Workers: os "funcionários" que pegam as tarefas da fila e executam.
//
// Por padrão rodam dentro do próprio servidor (src/server.ts). Com muitos parceiros,
// dá para rodar o servidor com INICIAR_WORKERS=false e subir quantos workers forem
// precisos em processos separados (npm run worker): a fila divide as tarefas entre eles.
import { UnrecoverableError, Worker } from "bullmq";
import type { Job } from "bullmq";
import { ErroApp } from "./errors/erros.js";
import { FILA_RELATORIOS, FILA_WEBHOOKS, TENTATIVAS_RELATORIO, agendarRelatoriosMensais, conexaoRedis } from "./lib/fila.js";
import * as relatorioAnaliticoService from "./services/relatorioAnaliticoService.js";
import * as webhookService from "./services/webhookService.js";

// Quantas tarefas cada worker faz ao mesmo tempo.
const RELATORIOS_AO_MESMO_TEMPO = 2;
const WEBHOOKS_AO_MESMO_TEMPO = 5;

interface Registro {
    info(mensagem: string): void;
    error(mensagem: string): void;
}

const workers: Worker[] = [];

function mensagemDe(erro: unknown) {
    return erro instanceof Error ? erro.message : String(erro);
}

async function processarRelatorio(job: Job) {
    // Agendamento mensal: só cria o pedido e põe na fila (com as tentativas normais).
    if (job.name === "agendado") {
        await relatorioAnaliticoService.pedirAgendado(job.data.tipo);
        return;
    }

    const id: string = job.data.relatorioId;
    const ultimaTentativa = job.attemptsMade + 1 >= TENTATIVAS_RELATORIO;

    try {
        await relatorioAnaliticoService.processar(id, ultimaTentativa);
    } catch (erro) {
        // Erro de dados (4xx): tentar de novo daria o mesmo erro. Falha na hora.
        const erroDeDados = erro instanceof ErroApp && erro.statusCode < 500;

        if (erroDeDados) {
            await relatorioAnaliticoService.marcarFalhaDefinitiva(id, erro.message);
        }

        if (erroDeDados || ultimaTentativa) {
            await webhookService.agendarAviso(id);
        }

        throw erroDeDados ? new UnrecoverableError(erro.message) : erro;
    }

    await webhookService.agendarAviso(id);
}

async function entregarWebhook(job: Job) {
    await webhookService.entregar(job.data.relatorioId);
}

export async function iniciarWorkers(registro: Registro) {
    if (!process.env.REDIS_URL) {
        registro.error("REDIS_URL não definida: a fila está desligada (relatórios pela API e agendamentos não funcionam)");
        return;
    }

    const relatorios = new Worker(FILA_RELATORIOS, processarRelatorio, { connection: conexaoRedis(), concurrency: RELATORIOS_AO_MESMO_TEMPO });
    const webhooks = new Worker(FILA_WEBHOOKS, entregarWebhook, { connection: conexaoRedis(), concurrency: WEBHOOKS_AO_MESMO_TEMPO });

    relatorios.on("failed", (job, erro) => {
        registro.error(`Relatório ${job?.data.relatorioId ?? job?.name} falhou (tentativa ${job?.attemptsMade}): ${mensagemDe(erro)}`);
    });

    webhooks.on("failed", (job, erro) => {
        registro.error(`Aviso do relatório ${job?.data.relatorioId} não foi entregue (tentativa ${job?.attemptsMade}): ${mensagemDe(erro)}`);
    });

    workers.push(relatorios, webhooks);
    await agendarRelatoriosMensais();
    registro.info("Fila ligada: workers de relatórios e webhooks rodando; relatórios mensais agendados (dia 1º, 3h)");
}

// Graceful shutdown: espera a tarefa em andamento terminar antes de desligar.
export async function fecharWorkers() {
    for (const worker of workers) {
        await worker.close();
    }

    workers.length = 0;
}
