// Relatório 2: rentabilidade por tipo de equipamento.
// Valor médio de recuperação (quanto o parceiro de destino pagou) conforme o tipo,
// o estado físico, a marca e o modelo. Ajuda a priorizar o que dá mais retorno.
import * as analiseRepository from "../../repositories/analiseRepository.js";
import { somarDias } from "../../utils/datas.js";
import { agrupar, arredondar, resumir } from "../../utils/estatistica.js";

type Equipamento = Awaited<ReturnType<typeof analiseRepository.listarEquipamentosComValor>>[number];

interface ItemComValor {
    tipo: string;
    marca: string;
    modelo: string;
    estadoFisico: string;
    destinacao: string;
    valor: number;
}

function converter(equipamento: Equipamento): ItemComValor {
    return {
        tipo: equipamento.tipo,
        marca: equipamento.marca,
        modelo: equipamento.modelo,
        estadoFisico: equipamento.estadoFisico,
        destinacao: equipamento.historicoMovimentacao[0]?.destino ?? equipamento.statusRastreamento,
        valor: Number(equipamento.valorRecuperacao),
    };
}

// Resumo de cada grupo, do que rende mais para o que rende menos.
function resumirGrupos(itens: ItemComValor[], chaveDe: (item: ItemComValor) => string, campos: (primeiro: ItemComValor) => object) {
    const grupos = agrupar(itens, chaveDe);

    const resumo = [...grupos.values()].map((grupo) => {
        const valores = grupo.map((item) => item.valor);
        const total = arredondar(valores.reduce((soma, valor) => soma + valor, 0));
        return { ...campos(grupo[0]!), valor: resumir(valores), valorTotal: total };
    });

    return resumo.sort((a, b) => b.valor.media - a.valor.media);
}

export async function gerar(inicio: Date, fim: Date, organizacaoId: string | null) {
    const equipamentos = await analiseRepository.listarEquipamentosComValor(inicio, somarDias(fim, 1), organizacaoId);
    const itens = equipamentos.map(converter);
    const valores = itens.map((item) => item.valor);
    const porMarcaModelo = resumirGrupos(itens, (item) => `${item.tipo}|${item.marca}|${item.modelo}`, (item) => ({ tipo: item.tipo, marca: item.marca, modelo: item.modelo }));

    return {
        periodo: { inicio, fim },
        equipamentosComValor: itens.length,
        valorTotalRecuperado: arredondar(valores.reduce((soma, valor) => soma + valor, 0)),
        valorPorEquipamento: resumir(valores),
        porTipo: resumirGrupos(itens, (item) => item.tipo, (item) => ({ tipo: item.tipo })),
        porEstadoFisico: resumirGrupos(itens, (item) => item.estadoFisico, (item) => ({ estadoFisico: item.estadoFisico })),
        porDestinacao: resumirGrupos(itens, (item) => item.destinacao, (item) => ({ destinacao: item.destinacao })),
        porTipoEEstado: resumirGrupos(itens, (item) => `${item.tipo}|${item.estadoFisico}`, (item) => ({ tipo: item.tipo, estadoFisico: item.estadoFisico })),
        porMarcaEModelo: porMarcaModelo,
        modeloMaisRentavel: porMarcaModelo[0] ?? null,
        modeloMenosRentavel: porMarcaModelo[porMarcaModelo.length - 1] ?? null,
    };
}
