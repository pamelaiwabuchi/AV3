// Histórico de exemplo de 1 ano, para os relatórios analíticos terem dados para analisar:
// ~40 lotes, ~300 equipamentos, movimentações, falhas e valores de recuperação.
//
// Os números são sorteados, mas com semente fixa: rodando de novo num banco novo,
// sai sempre o mesmo histórico (e os relatórios dão sempre o mesmo resultado).
//
// Os services gravam sempre a data de "agora"; aqui as datas são do passado, por isso
// este arquivo grava direto pelo Prisma, dentro de executarTransacao (a auditoria
// registra o gestor responsável). Os lotes do histórico têm nota fiscal "HIST-...".
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { executarTransacao } from "../src/lib/transacao.js";
import type { Transacao } from "../src/lib/transacao.js";
import { EstadoFisico } from "../src/generated/prisma/enums.js";
import type { GravidadeFalha, StatusRastreamento, TipoEquipamento, TipoFalha } from "../src/generated/prisma/enums.js";
import { calcularStatusLote } from "../src/utils/regrasStatus.js";
import * as usuarioService from "../src/services/usuarioService.js";
import * as contratoService from "../src/services/contratoService.js";

const UM_DIA = 24 * 60 * 60 * 1000;
const QUANTIDADE_DE_LOTES = 42;
const ESTADOS = Object.values(EstadoFisico); // NOVO (nível 0) ... INSERVIVEL (nível 6)

// ---------- sorteio com semente fixa ----------

// Gerador de números "aleatórios" que sempre repete a mesma sequência (mulberry32).
let semente = 2026;

function sortear() {
    semente = (semente + 0x6d2b79f5) | 0;
    let t = semente;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = t ^ (t + Math.imul(t ^ (t >>> 7), t | 61));
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function entre(minimo: number, maximo: number) {
    return minimo + sortear() * (maximo - minimo);
}

function inteiroEntre(minimo: number, maximo: number) {
    return Math.floor(entre(minimo, maximo + 1));
}

function escolher<T>(lista: T[]) {
    return lista[Math.floor(sortear() * lista.length)]!;
}

// Escolhe um item respeitando o peso de cada um (peso maior = sai mais vezes).
function escolherComPeso<T>(itens: [T, number][]) {
    const total = itens.reduce((soma, [, peso]) => soma + peso, 0);
    let alvo = sortear() * total;

    for (const [item, peso] of itens) {
        alvo = alvo - peso;

        if (alvo <= 0) {
            return item;
        }
    }

    return itens[itens.length - 1]![0];
}

function arredondar(valor: number) {
    return Math.round(valor * 100) / 100;
}

// ---------- catálogo do "mundo real" usado no sorteio ----------

interface Modelo {
    marca: string;
    modelo: string;
    fatorDePreco: number; // marca/modelo que vale mais no mercado de peças
}

interface PerfilDoTipo {
    peso: number; // chance de aparecer num lote
    pesoKg: number;
    vidaUtilAnos: number; // idade em que costuma ficar inservível
    valorDasPecas: number; // R$ das peças de um equipamento NOVO
    valorPorKg: number; // R$ por kg de material reciclável
    modelos: Modelo[];
    falhasComuns: TipoFalha[];
}

const PERFIS: Record<TipoEquipamento, PerfilDoTipo> = {
    NOTEBOOK: {
        peso: 25, pesoKg: 2.2, vidaUtilAnos: 7, valorDasPecas: 240, valorPorKg: 9,
        modelos: [
            { marca: "Dell", modelo: "Latitude 5490", fatorDePreco: 1.2 },
            { marca: "Lenovo", modelo: "ThinkPad T480", fatorDePreco: 1.25 },
            { marca: "Apple", modelo: "MacBook Air", fatorDePreco: 1.7 },
            { marca: "HP", modelo: "ProBook 440", fatorDePreco: 1.0 },
            { marca: "Positivo", modelo: "Motion", fatorDePreco: 0.6 },
        ],
        falhasComuns: ["BATERIA_VICIADA", "TELA_DANIFICADA", "TECLADO_PERIFERICOS", "ARMAZENAMENTO", "PLACA_MAE", "CARCACA_QUEBRADA", "CONECTORES_PORTAS", "SUPERAQUECIMENTO"],
    },
    COMPUTADOR_MESA: {
        peso: 22, pesoKg: 8, vidaUtilAnos: 10, valorDasPecas: 160, valorPorKg: 3.5,
        modelos: [
            { marca: "Dell", modelo: "OptiPlex 7070", fatorDePreco: 1.2 },
            { marca: "HP", modelo: "EliteDesk 800", fatorDePreco: 1.1 },
            { marca: "Lenovo", modelo: "ThinkCentre M720", fatorDePreco: 1.1 },
            { marca: "Positivo", modelo: "Master D", fatorDePreco: 0.7 },
        ],
        falhasComuns: ["NAO_LIGA", "PLACA_MAE", "FONTE", "ARMAZENAMENTO", "MEMORIA", "SUPERAQUECIMENTO", "OXIDACAO_CORROSAO"],
    },
    MONITOR: {
        peso: 20, pesoKg: 4.5, vidaUtilAnos: 11, valorDasPecas: 70, valorPorKg: 2,
        modelos: [
            { marca: "LG", modelo: "24MK430", fatorDePreco: 1.0 },
            { marca: "Samsung", modelo: "S24F350", fatorDePreco: 1.0 },
            { marca: "Dell", modelo: "P2419H", fatorDePreco: 1.2 },
            { marca: "AOC", modelo: "22B1HS", fatorDePreco: 0.8 },
        ],
        falhasComuns: ["TELA_DANIFICADA", "NAO_LIGA", "CONECTORES_PORTAS", "CARCACA_QUEBRADA", "FONTE"],
    },
    IMPRESSORA: {
        peso: 8, pesoKg: 7, vidaUtilAnos: 8, valorDasPecas: 55, valorPorKg: 1.5,
        modelos: [
            { marca: "HP", modelo: "LaserJet M1132", fatorDePreco: 1.0 },
            { marca: "Epson", modelo: "L3150", fatorDePreco: 1.1 },
            { marca: "Brother", modelo: "DCP-L2540", fatorDePreco: 1.0 },
        ],
        falhasComuns: ["NAO_LIGA", "PLACA_MAE", "CARCACA_QUEBRADA", "CONECTORES_PORTAS", "OXIDACAO_CORROSAO"],
    },
    SERVIDOR: {
        peso: 4, pesoKg: 22, vidaUtilAnos: 9, valorDasPecas: 650, valorPorKg: 6,
        modelos: [
            { marca: "Dell", modelo: "PowerEdge R640", fatorDePreco: 1.2 },
            { marca: "HP", modelo: "ProLiant DL380", fatorDePreco: 1.15 },
            { marca: "IBM", modelo: "System x3650", fatorDePreco: 0.9 },
        ],
        falhasComuns: ["ARMAZENAMENTO", "MEMORIA", "FONTE", "PLACA_MAE", "SUPERAQUECIMENTO"],
    },
    ROTEADOR: {
        peso: 8, pesoKg: 0.4, vidaUtilAnos: 7, valorDasPecas: 35, valorPorKg: 4,
        modelos: [
            { marca: "TP-Link", modelo: "Archer C6", fatorDePreco: 0.9 },
            { marca: "Cisco", modelo: "RV340", fatorDePreco: 1.6 },
            { marca: "Intelbras", modelo: "Action RF 1200", fatorDePreco: 0.8 },
        ],
        falhasComuns: ["NAO_LIGA", "CONECTORES_PORTAS", "SUPERAQUECIMENTO", "PLACA_MAE"],
    },
    CABO_ESTRUTURADO: {
        peso: 5, pesoKg: 10, vidaUtilAnos: 15, valorDasPecas: 20, valorPorKg: 12,
        modelos: [
            { marca: "Furukawa", modelo: "Cat6", fatorDePreco: 1.0 },
            { marca: "Nexans", modelo: "Cat5e", fatorDePreco: 0.9 },
        ],
        falhasComuns: ["CONECTORES_PORTAS", "OXIDACAO_CORROSAO"],
    },
    FONTE_ALIMENTACAO: {
        peso: 8, pesoKg: 1.4, vidaUtilAnos: 9, valorDasPecas: 30, valorPorKg: 5,
        modelos: [
            { marca: "Corsair", modelo: "CV550", fatorDePreco: 1.2 },
            { marca: "EVGA", modelo: "500W", fatorDePreco: 1.0 },
            { marca: "C3Tech", modelo: "PS-200", fatorDePreco: 0.6 },
        ],
        falhasComuns: ["NAO_LIGA", "SUPERAQUECIMENTO", "OXIDACAO_CORROSAO", "CONECTORES_PORTAS"],
    },
};

// Quanto o estado físico conserva do valor das peças (NOVO = 100% ... INSERVÍVEL = 15%).
const FATOR_DO_ESTADO = [1.0, 0.9, 0.8, 0.65, 0.5, 0.3, 0.15];

const TRANSPORTADORAS = ["TransLog", "Rápido Sul", "Via Verde Cargas", "Expresso Vale"];

// Gestores do histórico e a "velocidade" de cada um (1 = normal, maior = mais lento).
// Isso aparece no relatório de eficiência como variação entre operadores.
const GESTORES = [
    { login: "bruno.gestor", nome: "Bruno Gestor", lentidao: 1.0 },
    { login: "diego.gestor", nome: "Diego Almeida", lentidao: 1.5 },
    { login: "elisa.gestor", nome: "Elisa Moraes", lentidao: 0.8 },
];

// Dezembro, janeiro e julho (férias e fim de ano) a triagem anda mais devagar.
function lentidaoDoMes(data: Date) {
    const mes = data.getUTCMonth();
    return mes === 11 || mes === 0 || mes === 6 ? 1.6 : 1.0;
}

// ---------- preparação: contratos e gestores ----------

// O lote só pode existir dentro de um contrato. Se a organização não tem contrato
// cobrindo o último ano, cria um contrato anterior ao mais antigo que ela tem.
async function garantirContratoNoPeriodo(organizacaoId: string, inicioDoHistorico: Date, idAdmin: string) {
    const maisAntigo = await prisma.contrato.findFirst({ where: { organizacaoId }, orderBy: { dataAssinatura: "asc" } });

    if (maisAntigo && maisAntigo.dataAssinatura <= inicioDoHistorico) {
        return;
    }

    const fim = maisAntigo ? new Date(maisAntigo.dataAssinatura.getTime() - UM_DIA) : new Date();
    const dados = {
        dataAssinatura: new Date(fim.getTime() - 400 * UM_DIA),
        dataVencimento: fim,
        clausulas: ["Coleta mensal de equipamentos", "Emissão de certificado de destinação"],
        valorMensal: 2200,
        renovacaoAutomatica: false,
    };

    await contratoService.criar(organizacaoId, dados, idAdmin);
}

async function idsDosGestores(idAdmin: string) {
    const triagem = await prisma.departamento.findUniqueOrThrow({ where: { nome: "Triagem" } });
    const ids: { id: string; lentidao: number }[] = [];

    for (const gestor of GESTORES) {
        let usuario = await prisma.usuario.findUnique({ where: { login: gestor.login } });

        if (!usuario) {
            const pedido = { nome: gestor.nome, login: gestor.login, senha: "Greencode1", papel: "GESTOR_ALMOXARIFADO", departamentoId: triagem.id };
            await usuarioService.criar(pedido, idAdmin);
            usuario = await prisma.usuario.findUniqueOrThrow({ where: { login: gestor.login } });
        }

        ids.push({ id: usuario.id, lentidao: gestor.lentidao });
    }

    return ids;
}

// ---------- sorteio de um equipamento ----------

interface Destinos {
    pecas: string;
    reciclagem: string;
}

// Nível do estado físico (0 = NOVO ... 6 = INSERVÍVEL): piora com a idade, com variação.
function sortearNivel(idade: number, perfil: PerfilDoTipo) {
    const nivel = Math.round((idade / perfil.vidaUtilAnos) * 6 + entre(-1, 1));
    return Math.min(6, Math.max(0, nivel));
}

function escolherDestinacao(nivel: number): StatusRastreamento {
    if (nivel <= 2) {
        return "PECAS_REAPROVEITADAS";
    }

    if (nivel <= 4) {
        return sortear() < 0.5 ? "PECAS_REAPROVEITADAS" : "MATERIAL_RECICLAVEL";
    }

    return nivel === 5 ? "MATERIAL_RECICLAVEL" : "DESCARTE_SEGURO";
}

function calcularValor(destinacao: StatusRastreamento, perfil: PerfilDoTipo, modelo: Modelo, nivel: number, pesoKg: number) {
    if (destinacao === "PECAS_REAPROVEITADAS") {
        return arredondar(perfil.valorDasPecas * modelo.fatorDePreco * FATOR_DO_ESTADO[nivel]! * entre(0.85, 1.15));
    }

    if (destinacao === "MATERIAL_RECICLAVEL") {
        return arredondar(pesoKg * perfil.valorPorKg * entre(0.8, 1.2));
    }

    return 0;
}

// Mais falhas e mais graves quanto pior o estado.
function sortearFalhas(nivel: number, perfil: PerfilDoTipo) {
    const quantidade = [0, sortear() < 0.2 ? 1 : 0, inteiroEntre(0, 1), 1, inteiroEntre(1, 2), 2, inteiroEntre(2, 3)][nivel]!;
    const falhas: { tipo: TipoFalha; gravidade: GravidadeFalha }[] = [];

    for (let i = 0; i < quantidade; i++) {
        const gravidade: GravidadeFalha = nivel <= 2 ? "LEVE" : nivel <= 4 ? escolher(["LEVE", "MODERADA", "MODERADA"]) : escolher(["MODERADA", "GRAVE", "GRAVE"]);
        falhas.push({ tipo: escolher(perfil.falhasComuns), gravidade });
    }

    return falhas;
}

// Passos que o equipamento faz depois da entrada, com o tempo (em dias) de cada um.
function montarCaminho(tipo: TipoEquipamento, destinacao: StatusRastreamento, lentidao: number) {
    const caminho: { status: StatusRastreamento; dias: number }[] = [{ status: "EM_TRIAGEM", dias: 0 }];
    const podeDesmontar = tipo === "NOTEBOOK" || tipo === "COMPUTADOR_MESA" || tipo === "SERVIDOR";

    if (podeDesmontar && destinacao !== "DESCARTE_SEGURO" && sortear() < 0.5) {
        caminho.push({ status: "AGUARDANDO_DESMONTE", dias: entre(0.2, 1) * lentidao });
        caminho.push({ status: "EM_DESMONTE", dias: entre(0.5, 3) * lentidao });
    }

    caminho.push({ status: destinacao, dias: entre(0.5, 3) * lentidao });
    caminho.push({ status: "BAIXA_DEFINITIVA", dias: entre(3, 15) });

    return caminho;
}

// ---------- gravação de um lote ----------

async function proximoCodigo(tx: Transacao, ano: number) {
    const [linha] = await tx.$queryRaw<{ numero: bigint }[]>`SELECT nextval('codigo_equipamento_seq') AS numero`;
    return `GC-${ano}-${String(Number(linha!.numero)).padStart(6, "0")}`;
}

async function criarLoteDoHistorico(numero: number, organizacaoId: string, dataEntrada: Date, gestor: { id: string; lentidao: number }, destinos: Destinos) {
    const agora = Date.now();
    const ano = dataEntrada.getUTCFullYear();
    const lentidao = gestor.lentidao * lentidaoDoMes(dataEntrada);
    const inicioDaTriagem = dataEntrada.getTime() + 9 * 60 * 60 * 1000 + entre(0.5, 3) * lentidao * UM_DIA;

    await executarTransacao(gestor.id, async (tx) => {
        const lote = await tx.lote.create({
            data: {
                organizacaoId,
                dataEntrada,
                notaFiscal: `HIST-${ano}-${String(numero).padStart(4, "0")}`,
                transportadora: escolher(TRANSPORTADORAS),
                observacoes: null,
                dataStatus: dataEntrada,
            },
        });

        const equipamentos = [];
        const movimentacoes = [];
        const falhas = [];
        let ultimaMudanca = dataEntrada.getTime();
        const quantidade = inteiroEntre(4, 12);

        for (let posicao = 1; posicao <= quantidade; posicao++) {
            const tipo = escolherComPeso(Object.entries(PERFIS).map(([nome, perfil]) => [nome as TipoEquipamento, perfil.peso]));
            const perfil = PERFIS[tipo];
            const modelo = escolher(perfil.modelos);
            const idade = inteiroEntre(1, Math.round(perfil.vidaUtilAnos * 1.2));
            const nivel = sortearNivel(idade, perfil);
            const pesoKg = arredondar(perfil.pesoKg * entre(0.8, 1.2));
            const destinacao = escolherDestinacao(nivel);
            const id = randomUUID();

            movimentacoes.push({ equipamentoId: id, dataHora: dataEntrada, origem: null, destino: "AGUARDANDO_TRIAGEM" as StatusRastreamento, responsavelId: gestor.id, observacao: "Entrada no lote" });

            // Percorre o caminho até onde o tempo já chegou (lotes recentes ficam no meio do caminho).
            let status: StatusRastreamento = "AGUARDANDO_TRIAGEM";
            let momento = inicioDaTriagem + posicao * 20 * 60 * 1000;

            for (const passo of montarCaminho(tipo, destinacao, lentidao)) {
                momento = momento + passo.dias * UM_DIA;

                if (momento > agora - UM_DIA) {
                    break;
                }

                movimentacoes.push({ equipamentoId: id, dataHora: new Date(momento), origem: status, destino: passo.status, responsavelId: gestor.id, observacao: null });
                status = passo.status;
                ultimaMudanca = Math.max(ultimaMudanca, momento);

                if (passo.status === "EM_TRIAGEM") {
                    for (const falha of sortearFalhas(nivel, perfil)) {
                        falhas.push({ equipamentoId: id, ...falha, descricao: null, dataRegistro: new Date(momento + 30 * 60 * 1000), responsavelId: gestor.id });
                    }
                }
            }

            const chegouAoDestino = status === destinacao || status === "BAIXA_DEFINITIVA";
            const triado = status !== "AGUARDANDO_TRIAGEM";

            equipamentos.push({
                id,
                codigoBarrasInterno: await proximoCodigo(tx, ano),
                tipo,
                marca: modelo.marca,
                modelo: modelo.modelo,
                anoFabricacao: ano - idade,
                estadoFisico: triado ? ESTADOS[nivel]! : ESTADOS[Math.max(0, nivel - 1)]!,
                pesoQuilogramas: pesoKg,
                loteId: lote.id,
                posicaoNoLote: posicao,
                statusRastreamento: status,
                destinoId: chegouAoDestino ? (destinacao === "PECAS_REAPROVEITADAS" ? destinos.pecas : destinos.reciclagem) : null,
                valorRecuperacao: chegouAoDestino ? calcularValor(destinacao, perfil, modelo, nivel, pesoKg) : null,
            });
        }

        await tx.equipamento.createMany({ data: equipamentos });
        await tx.movimentacao.createMany({ data: movimentacoes });
        await tx.falha.createMany({ data: falhas });

        const statusDoLote = calcularStatusLote(equipamentos.map((equipamento) => equipamento.statusRastreamento));
        const dataStatus = statusDoLote === "RECEBIDO" ? dataEntrada : new Date(ultimaMudanca);
        await tx.lote.update({ where: { id: lote.id }, data: { statusProcessamento: statusDoLote, dataStatus } });
    });
}

// ---------- ponto de entrada (chamado pelo seed.ts) ----------

export async function criarHistoricoDeExemplo() {
    if ((await prisma.lote.count({ where: { notaFiscal: { startsWith: "HIST-" } } })) > 0) {
        console.log("Histórico de exemplo já existe, nada foi alterado.");
        return;
    }

    const admin = await prisma.usuario.findUniqueOrThrow({ where: { login: process.env.ADMIN_LOGIN! } });
    const techCorp = await prisma.organizacao.findUnique({ where: { cnpj: "52601815000120" } });
    const escola = await prisma.organizacao.findUnique({ where: { cnpj: "90830166000128" } });
    const ecoPecas = await prisma.destino.findUnique({ where: { cnpj: "08246281000179" } });
    const recicla = await prisma.destino.findUnique({ where: { cnpj: "39099603000128" } });

    if (!techCorp || !escola || !ecoPecas || !recicla) {
        console.log("Histórico de exemplo não criado: faltam as organizações ou destinos do seed.");
        return;
    }

    const hoje = new Date();
    const inicioDoHistorico = new Date(Date.UTC(hoje.getUTCFullYear() - 1, hoje.getUTCMonth(), hoje.getUTCDate()));

    await garantirContratoNoPeriodo(techCorp.id, inicioDoHistorico, admin.id);
    await garantirContratoNoPeriodo(escola.id, inicioDoHistorico, admin.id);

    const gestores = await idsDosGestores(admin.id);
    const destinos = { pecas: ecoPecas.id, reciclagem: recicla.id };

    for (let numero = 1; numero <= QUANTIDADE_DE_LOTES; numero++) {
        // Lotes espalhados pelo ano, do mais antigo (há ~1 ano) ao mais recente (há ~2 dias):
        // os mais recentes ficam no meio do caminho (em triagem, encaminhados...).
        const diasAtras = Math.max(2, Math.round(365 - (numero - 1) * (363 / (QUANTIDADE_DE_LOTES - 1)) + entre(-3, 3)));
        const dataEntrada = new Date(inicioDoHistorico.getTime() + (365 - diasAtras) * UM_DIA);
        const organizacaoId = sortear() < 0.6 ? techCorp.id : escola.id;

        await criarLoteDoHistorico(numero, organizacaoId, dataEntrada, escolher(gestores), destinos);
    }

    const equipamentos = await prisma.equipamento.count({ where: { lote: { notaFiscal: { startsWith: "HIST-" } } } });
    console.log(`Histórico de exemplo criado: ${QUANTIDADE_DE_LOTES} lotes e ${equipamentos} equipamentos ao longo de 1 ano.`);
}
