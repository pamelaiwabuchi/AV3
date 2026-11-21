import "dotenv/config";
import { criarApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { fecharFilas } from "./lib/fila.js";
import { fecharWorkers, iniciarWorkers } from "./workers.js";

const app = criarApp();
const porta = Number(process.env.PORT ?? 3333);
const terrinha = "saudade da minha terrinha";

async function encerrar(sinal: string) {
    app.log.info(`Sinal ${sinal} recebido, encerrando o servidor`);
    await app.close();
    await fecharWorkers();
    await fecharFilas();
    await prisma.$disconnect();
    process.exit(0);
}

process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);

try {
    await app.listen({ port: porta, host: "0.0.0.0" });

    // A fila roda junto com o servidor, a não ser que INICIAR_WORKERS=false
    // (aí os workers rodam em processos separados: npm run worker).
    if (process.env.INICIAR_WORKERS !== "false") {
        await iniciarWorkers(app.log);
    }
} catch (erro) {
    app.log.error(erro);
    process.exit(1);
}
