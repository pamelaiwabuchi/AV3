// Webhook: o greencode avisa o sistema do parceiro quando um relatório pedido pela API
// termina (pronto ou com falha), em vez de o parceiro ficar perguntando (polling).
//
// Segurança: cada aviso vai com o cabeçalho x-greencode-assinatura = HMAC-SHA256 do corpo,
// calculado com um segredo que só o greencode e o parceiro conhecem. O parceiro refaz a
// conta do lado dele; se bater, o aviso é verdadeiro (ninguém mais conseguiria assinar).
import { createHmac, randomBytes } from "node:crypto";
import { ErroNaoEncontrado, ErroRegraNegocio } from "../errors/erros.js";
import { executarTransacao } from "../lib/transacao.js";
import { enfileirarWebhook } from "../lib/fila.js";
import * as organizacaoRepository from "../repositories/organizacaoRepository.js";
import * as relatorioAnaliticoRepository from "../repositories/relatorioAnaliticoRepository.js";
import { PREFIXO_PUBLICO } from "../utils/prefixos.js";

// O sistema do parceiro tem 10 segundos para responder; depois disso, conta como falha.
const TEMPO_LIMITE_MS = 10 * 1000;

export function assinar(corpo: string, segredo: string) {
    return createHmac("sha256", segredo).update(corpo).digest("hex");
}

// Só https: o aviso leva dados do parceiro, e isso também impede apontar o webhook
// para serviços internos da rede (http://banco:5432, por exemplo).
function validarEndereco(url: string) {
    if (!url.startsWith("https://")) {
        throw new ErroRegraNegocio("O endereço do webhook precisa começar com https://");
    }
}

export async function consultar(organizacaoId: string) {
    const organizacao = await organizacaoRepository.buscarWebhook(organizacaoId);

    if (!organizacao) {
        throw new ErroNaoEncontrado("Organização não encontrada");
    }

    return { url: organizacao.webhookUrl, configurado: organizacao.webhookUrl !== null };
}

// Cadastra (ou troca) o endereço e gera um segredo novo, mostrado só nesta resposta.
export async function configurar(organizacaoId: string, url: string, idUsuario: string) {
    validarEndereco(url);
    const segredo = `whsec_${randomBytes(24).toString("hex")}`;

    await executarTransacao(idUsuario, async (tx) => {
        await organizacaoRepository.salvarWebhook(tx, organizacaoId, url, segredo);
    });

    return {
        url,
        segredo,
        aviso: "Guarde o segredo: ele não aparece de novo. Use-o para conferir o cabeçalho x-greencode-assinatura (HMAC-SHA256 do corpo, em hexadecimal, com o prefixo sha256=)",
    };
}

export async function remover(organizacaoId: string, idUsuario: string) {
    await executarTransacao(idUsuario, async (tx) => {
        await organizacaoRepository.salvarWebhook(tx, organizacaoId, null, null);
    });

    return { url: null, configurado: false };
}

// Chamado pelo worker quando um relatório termina: se é um pedido da API e a organização
// tem webhook, coloca o aviso na fila de webhooks.
export async function agendarAviso(relatorioId: string) {
    const relatorio = await relatorioAnaliticoRepository.buscarPorId(relatorioId);

    if (!relatorio || relatorio.origem !== "API" || !relatorio.organizacaoId) {
        return;
    }

    const webhook = await organizacaoRepository.buscarWebhook(relatorio.organizacaoId);

    if (webhook?.webhookUrl) {
        await enfileirarWebhook(relatorioId);
    }
}

// Chamado pelo worker de webhooks: monta o aviso, assina e envia. Erro = nova tentativa.
export async function entregar(relatorioId: string) {
    const relatorio = await relatorioAnaliticoRepository.buscarPorId(relatorioId);
    const webhook = relatorio?.organizacaoId ? await organizacaoRepository.buscarWebhook(relatorio.organizacaoId) : null;

    if (!relatorio || !webhook?.webhookUrl || !webhook.webhookSegredo) {
        return;
    }

    const evento = relatorio.status === "CONCLUIDO" ? "relatorio.concluido" : "relatorio.falhou";
    const enderecoDoRelatorio = `${PREFIXO_PUBLICO}/relatorios/${relatorio.id}`;
    const corpo = JSON.stringify({
        evento,
        relatorioId: relatorio.id,
        tipo: relatorio.tipo,
        status: relatorio.status,
        dataPedido: relatorio.dataPedido,
        dataConclusao: relatorio.dataConclusao,
        erro: relatorio.erro,
        links: {
            status: enderecoDoRelatorio,
            downloadJson: `${enderecoDoRelatorio}/download?formato=json`,
            downloadCsv: `${enderecoDoRelatorio}/download?formato=csv`,
        },
    });

    try {
        const resposta = await fetch(webhook.webhookUrl, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-greencode-evento": evento,
                "x-greencode-assinatura": `sha256=${assinar(corpo, webhook.webhookSegredo)}`,
            },
            body: corpo,
            signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        });

        if (!resposta.ok) {
            throw new Error(`O sistema do parceiro respondeu ${resposta.status}`);
        }
    } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        await relatorioAnaliticoRepository.registrarEntregaDoWebhook(relatorioId, mensagem);
        throw erro;
    }

    await relatorioAnaliticoRepository.registrarEntregaDoWebhook(relatorioId, null);
}
