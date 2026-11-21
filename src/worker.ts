// Worker separado do servidor: roda só a fila (npm run worker).
// Útil para escalar: vários processos de worker dividem as tarefas da mesma fila.
import "dotenv/config";
import { prisma } from "./lib/prisma.js";
import { fecharFilas } from "./lib/fila.js";
import { fecharWorkers, iniciarWorkers } from "./workers.js";

async function encerrar(sinal: string) {
    console.log(`Sinal ${sinal} recebido, encerrando o worker`);
    await fecharWorkers();
    await fecharFilas();
    await prisma.$disconnect();
    process.exit(0);
}

process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);

await iniciarWorkers(console);
