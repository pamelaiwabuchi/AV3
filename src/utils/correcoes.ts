// Regra das correções de movimentação (AV2): uma correção desfaz a movimentação escolhida
// e todas as seguintes. Os relatórios precisam ignorar as movimentações desfeitas.

export interface Correcao {
    equipamentoId: string;
    desfezDesde: Date; // data da movimentação escolhida na correção
    dataHora: Date; // quando a correção foi feita
}

// Uma movimentação foi desfeita se uma correção posterior voltou para antes dela.
export function foiDesfeita(movimentacao: { equipamentoId: string; dataHora: Date }, correcoes: Correcao[]) {
    return correcoes.some((correcao) => {
        return correcao.equipamentoId === movimentacao.equipamentoId
            && correcao.desfezDesde <= movimentacao.dataHora
            && movimentacao.dataHora < correcao.dataHora;
    });
}
