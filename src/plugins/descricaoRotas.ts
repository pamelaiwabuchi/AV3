// Textos que aparecem no Swagger (/docs): o grupo de cada rota, um resumo do que ela faz
// (com os papéis que podem usá-la) e um exemplo de corpo pronto para o "Try it out".

import { ID_DEPARTAMENTO_EXEMPLO } from "../utils/esquemas.js";

const ID_DE_EXEMPLO = "00000000-0000-0000-0000-000000000000";

export const grupos = [
    { name: "Autenticação", description: "Login, troca da própria senha e perfil" },
    { name: "Usuários", description: "Cadastro de usuários (só ADMINISTRADOR)" },
    { name: "Departamentos", description: "Setores da empresa e seus funcionários (só ADMINISTRADOR)" },
    { name: "Organizações", description: "Clientes que enviam equipamentos" },
    { name: "Contratos", description: "Contratos de coleta das organizações" },
    { name: "Destinos", description: "Parceiros que recebem os equipamentos (reciclagem, peças, descarte)" },
    { name: "Lotes", description: "Chegada de equipamentos de uma organização" },
    { name: "Equipamentos", description: "Triagem, avaliação e movimentação de cada equipamento" },
    { name: "Movimentações", description: "Todas as mudanças de status, com filtros" },
    { name: "Painel e relatórios", description: "Resumo por papel e relatórios" },
    { name: "Relatórios analíticos", description: "Eficiência operacional, rentabilidade por tipo de equipamento e vida útil remanescente (previsão). Cada relatório gerado fica guardado para consulta histórica" },
    { name: "Certificados", description: "Certificado de destinação final em PDF (lote ou período)" },
    { name: "Chaves de API", description: "Chaves que dão acesso à API pública para cada organização parceira" },
    { name: "API pública (parceiros)", description: "Rotas em /api/v1/public para o sistema da organização parceira. Autenticação pela chave de API no cabeçalho x-api-key; limite de requisições por minuto por chave (429 ao passar). O parceiro só vê os dados da própria organização; o lote que ele envia fica AGUARDANDO_RECEBIMENTO e só pode ser alterado até a greencode confirmar a chegada" },
    { name: "Auditoria e parâmetros", description: "Histórico de alterações e configurações globais" },
    { name: "Sistema", description: "Situação do servidor" },
];

const grupoPorCaminho: Record<string, string> = {
    auth: "Autenticação",
    usuarios: "Usuários",
    departamentos: "Departamentos",
    organizacoes: "Organizações",
    contratos: "Contratos",
    destinos: "Destinos",
    lotes: "Lotes",
    equipamentos: "Equipamentos",
    falhas: "Equipamentos",
    movimentacoes: "Movimentações",
    painel: "Painel e relatórios",
    relatorios: "Painel e relatórios",
    auditoria: "Auditoria e parâmetros",
    parametros: "Auditoria e parâmetros",
};

export function grupoDaRota(url: string) {
    if (url.startsWith("/public")) {
        return "API pública (parceiros)";
    }

    if (url.endsWith("/certificado")) {
        return "Certificados";
    }

    if (url.startsWith("/relatorios/analiticos")) {
        return "Relatórios analíticos";
    }

    if (url.includes("chaves-api")) {
        return "Chaves de API";
    }

    if (url.endsWith("/contratos")) {
        return "Contratos";
    }

    const primeiraParte = url.split("/")[1] ?? "";
    return grupoPorCaminho[primeiraParte] ?? "Sistema";
}

export const resumos: Record<string, string> = {
    "POST /auth/login": "Faz login e devolve o token (todos)",
    "PATCH /auth/senha": "Troca a própria senha; obrigatório no primeiro acesso (todos)",
    "GET /auth/perfil": "Mostra os dados do usuário logado (todos)",

    "GET /usuarios": "Lista os usuários; busca por nome ou login e filtros de papel, departamento (id ou nome), ativo e bloqueado (ADMINISTRADOR)",
    "GET /usuarios/:id": "Mostra um usuário (ADMINISTRADOR)",
    "GET /usuarios/login/:login": "Mostra um usuário pelo login, ex.: ana.operadora (ADMINISTRADOR)",
    "POST /usuarios": "Cria um usuário com senha provisória; o departamentoId vem de GET /departamentos (ADMINISTRADOR)",
    "PATCH /usuarios/:id": "Altera nome, papel, departamento e/ou ativo; ativo false desativa (ADMINISTRADOR)",

    "GET /departamentos": "Lista os departamentos com a quantidade de usuários; busca por nome e filtro ativo (ADMINISTRADOR)",
    "GET /departamentos/:id": "Mostra um departamento (ADMINISTRADOR)",
    "GET /departamentos/:id/usuarios": "Lista os usuários ativos do departamento; busca por nome ou login (ADMINISTRADOR)",
    "POST /departamentos": "Cria um departamento; o nome não pode repetir (ADMINISTRADOR)",
    "PATCH /departamentos/:id": "Altera o nome e/ou ativo; desativado não recebe usuário novo (ADMINISTRADOR)",
    "PATCH /usuarios/:id/senha": "Redefine a senha de alguém; ela volta a ser provisória (ADMINISTRADOR)",

    "GET /organizacoes": "Lista as organizações; busca por razão social ou CNPJ (OPERADOR_CADASTRO, AUDITOR)",
    "GET /organizacoes/resumo": "Lista resumida das ativas com contrato vigente (GESTOR, OPERADOR_CADASTRO, AUDITOR)",
    "GET /organizacoes/:id": "Mostra uma organização (OPERADOR_CADASTRO, AUDITOR)",
    "POST /organizacoes": "Cadastra uma organização (OPERADOR_CADASTRO)",
    "PATCH /organizacoes/:id": "Altera dados da organização; ativo false desativa (OPERADOR_CADASTRO)",

    "GET /contratos": "Lista os contratos; filtros de situação, vencendoEmDias (ex.: 30), ano, organização por id, nome ou CNPJ (OPERADOR_CADASTRO, AUDITOR)",
    "GET /organizacoes/:id/contratos": "Lista os contratos de uma organização (OPERADOR_CADASTRO, AUDITOR)",

    "GET /organizacoes/:id/chaves-api": "Lista as chaves de API da organização, sem a chave em si (OPERADOR_CADASTRO, AUDITOR)",
    "POST /organizacoes/:id/chaves-api": "Gera a chave de API (aparece só nesta resposta) com permissões e limite por minuto do contrato; a anterior vale mais 24 h, ou para na hora com revogarAnteriorNaHora (OPERADOR_CADASTRO)",
    "POST /chaves-api/:id/revogar": "Revoga uma chave de API; ela para de funcionar na hora (OPERADOR_CADASTRO)",

    "POST /relatorios/analiticos": "Gera e guarda um relatório: EFICIENCIA (GESTOR, AUDITOR), RENTABILIDADE (AUDITOR) ou VIDA_UTIL (GESTOR, OPERADOR_CADASTRO, AUDITOR); período padrão: últimos 12 meses",
    "GET /relatorios/analiticos": "Histórico dos relatórios gerados (sem o resultado), só dos tipos que o seu papel pode ver; filtros de tipo e status",
    "GET /relatorios/analiticos/:id/download": "Baixa um relatório guardado em JSON (completo) ou CSV (tabela principal; abre no Excel)",
    "GET /relatorios/analiticos/:id": "Mostra um relatório guardado, com o resultado completo e, na vida útil, as previsões por tipo de equipamento",

    "POST /public/relatorios": "Pede um relatório (GERAR_RELATORIOS): EFICIENCIA dos lotes da organização ou VIDA_UTIL_INVENTARIO (previsão para até 5000 equipamentos que a organização ainda usa). Responde 202 na hora com o id; o cálculo vai para a fila",
    "GET /public/relatorios": "Lista os relatórios que a organização pediu, com o status de cada um (GERAR_RELATORIOS)",
    "GET /public/relatorios/:id": "Status do pedido (PENDENTE, PROCESSANDO, CONCLUIDO ou FALHOU); quando CONCLUIDO, traz o resultado (GERAR_RELATORIOS)",
    "GET /public/relatorios/:id/download": "Baixa o relatório pronto em JSON ou CSV; antes de ficar pronto responde 409 (GERAR_RELATORIOS)",
    "GET /public/webhook": "Mostra o endereço de webhook cadastrado (ATUALIZAR_CADASTRO)",
    "PUT /public/webhook": "Cadastra ou troca o endereço https que recebe o aviso quando um relatório termina; gera um segredo novo, mostrado só nesta resposta, para conferir a assinatura x-greencode-assinatura (ATUALIZAR_CADASTRO)",
    "DELETE /public/webhook": "Remove o webhook; os relatórios continuam disponíveis por consulta (ATUALIZAR_CADASTRO)",

    "GET /public/conta": "Dados da própria organização, se tem contrato vigente e as permissões da chave (qualquer chave válida)",
    "PATCH /public/conta": "Altera telefone, e-mail ou endereço da própria organização (ATUALIZAR_CADASTRO)",
    "GET /public/lotes": "Lista os lotes da organização, com filtro de status (LER_RASTREABILIDADE)",
    "GET /public/lotes/:id": "Mostra um lote com os equipamentos e o status de cada um (LER_RASTREABILIDADE)",
    "POST /public/lotes": "Avisa o envio de um lote com pelo menos 1 equipamento; ele fica AGUARDANDO_RECEBIMENTO até a greencode confirmar a chegada; precisa de contrato vigente; nota fiscal não pode repetir (GERENCIAR_LOTES)",
    "PATCH /public/lotes/:id": "Altera nota fiscal, transportadora, observações ou data prevista; só enquanto AGUARDANDO_RECEBIMENTO (GERENCIAR_LOTES)",
    "PATCH /public/lotes/:id/cancelar": "Cancela o lote e os equipamentos dele; só enquanto AGUARDANDO_RECEBIMENTO (GERENCIAR_LOTES)",
    "POST /public/lotes/:id/equipamentos": "Adiciona um equipamento ao lote; só enquanto AGUARDANDO_RECEBIMENTO (GERENCIAR_LOTES)",
    "GET /public/lotes/:id/certificado": "Baixa o certificado de destinação em PDF; só lote FINALIZADO (LER_RASTREABILIDADE)",
    "GET /public/equipamentos/:codigo": "Rastreabilidade: situação, histórico e falhas encontradas (laudo) de um equipamento pelo código de barras (LER_RASTREABILIDADE)",
    "PATCH /public/equipamentos/:codigo": "Altera tipo, marca, modelo, ano ou peso; só com o lote AGUARDANDO_RECEBIMENTO (GERENCIAR_LOTES)",
    "PATCH /public/equipamentos/:codigo/cancelar": "Remove (cancela) um equipamento; só com o lote AGUARDANDO_RECEBIMENTO e se não for o último (GERENCIAR_LOTES)",
    "GET /public/certificado": "Baixa o certificado em PDF com os lotes finalizados no período; padrão: do começo do ano até hoje (LER_RASTREABILIDADE)",
    "GET /public/resumo": "Lotes por status e destinação dos equipamentos (kg) no período; padrão: do começo do ano até hoje (LER_RASTREABILIDADE)",
    "GET /contratos/:id": "Mostra um contrato com a situação FUTURO, VIGENTE ou ENCERRADO (OPERADOR_CADASTRO, AUDITOR)",
    "POST /contratos": "Cria um contrato (OPERADOR_CADASTRO)",
    "PATCH /contratos/:id": "Altera um contrato que ainda não começou (OPERADOR_CADASTRO)",
    "PATCH /contratos/:id/renovar": "Estende o vencimento de um contrato vigente (OPERADOR_CADASTRO)",
    "PATCH /contratos/:id/encerrar": "Encerra um contrato vigente hoje (OPERADOR_CADASTRO)",
    "DELETE /contratos/:id": "Apaga um contrato que ainda não começou (OPERADOR_CADASTRO)",

    "GET /destinos": "Lista os parceiros de destino; o gestor vê só os ativos (OPERADOR_CADASTRO, GESTOR, AUDITOR)",
    "GET /destinos/:id": "Mostra um destino (OPERADOR_CADASTRO, GESTOR, AUDITOR)",
    "POST /destinos": "Cadastra um destino (OPERADOR_CADASTRO)",
    "PATCH /destinos/:id": "Altera um destino; ativo false desativa (OPERADOR_CADASTRO)",

    "GET /lotes": "Lista os lotes; filtros de status, ano de entrada, nota fiscal, transportadora e organização por id, nome ou CNPJ (GESTOR, OPERADOR_CADASTRO, AUDITOR)",
    "GET /lotes/parados": "Lotes sem andar há mais dias que o configurado (GESTOR, OPERADOR_CADASTRO, AUDITOR)",
    "GET /lotes/:id": "Mostra um lote com seus equipamentos e peso total (GESTOR, OPERADOR_CADASTRO, AUDITOR)",
    "POST /lotes": "Registra a chegada de um lote com seus equipamentos; o código de barras é gerado pelo sistema (GESTOR)",
    "PATCH /lotes/:id": "Altera nota fiscal, transportadora e/ou observações de um lote AGUARDANDO_RECEBIMENTO ou RECEBIDO (GESTOR)",
    "PATCH /lotes/:id/cancelar": "Cancela um lote AGUARDANDO_RECEBIMENTO ou RECEBIDO e todos os seus equipamentos (GESTOR)",
    "PATCH /lotes/:id/confirmar-recebimento": "Confirma a chegada de um lote avisado pela API: passa a RECEBIDO com a data de entrada (padrão: hoje) (GESTOR)",
    "POST /lotes/:id/equipamentos": "Adiciona um equipamento a um lote; o código de barras é gerado pelo sistema (GESTOR)",

    "GET /equipamentos": "Lista os equipamentos; filtros de status, tipo, código, marca, modelo, ano de fabricação, ano de entrada, estado físico, lote, organização e parceiro de destino por id, nome ou CNPJ (GESTOR, OPERADOR_CADASTRO, AUDITOR)",
    "GET /equipamentos/codigo/:codigo": "Busca pelo código de barras, ex.: GC-2026-000001 (GESTOR, OPERADOR_CADASTRO, AUDITOR)",
    "GET /equipamentos/:id": "Mostra um equipamento com a depreciação (GESTOR, OPERADOR_CADASTRO, AUDITOR)",
    "GET /equipamentos/:id/historico": "Histórico de movimentações do equipamento (GESTOR, AUDITOR)",
    "PATCH /equipamentos/:id": "Altera tipo, marca, modelo, ano e/ou peso enquanto AGUARDANDO_TRIAGEM (GESTOR)",
    "PATCH /equipamentos/:id/avaliacao": "Avalia o estado físico; queda de 2 níveis ou mais exige justificativa (GESTOR)",
    "GET /falhas": "Lista as falhas registradas; filtros de tipo, gravidade, tipo de equipamento e período; anuladas só com incluirAnuladas (GESTOR, OPERADOR_CADASTRO, AUDITOR)",
    "GET /equipamentos/:id/falhas": "Lista as falhas de um equipamento, inclusive as anuladas (GESTOR, OPERADOR_CADASTRO, AUDITOR)",
    "POST /equipamentos/:id/falhas": "Registra uma falha encontrada na triagem ou no desmonte (EM_TRIAGEM, AGUARDANDO_DESMONTE ou EM_DESMONTE); tipo OUTRO exige descricao (GESTOR)",
    "POST /falhas/:id/anular": "Anula uma falha registrada por engano, com justificativa; nada é apagado (GESTOR)",
    "POST /equipamentos/:id/movimentar": "Muda o status de um equipamento pelo id; para PECAS_REAPROVEITADAS ou MATERIAL_RECICLAVEL informe destinoId e valorRecuperacao (quanto o parceiro pagou) (GESTOR)",
    "POST /equipamentos/:id/corrigir": "Desfaz uma movimentação errada e as seguintes; o equipamento volta ao status de antes dela (GESTOR)",
    "POST /equipamentos/codigo/:codigo/movimentar": "Muda o status de um equipamento pelo código de barras; para PECAS_REAPROVEITADAS ou MATERIAL_RECICLAVEL informe destinoId e valorRecuperacao (GESTOR)",
    "POST /equipamentos/movimentar-varios": "Muda o status de vários equipamentos pelos códigos de barras; tudo ou nada; o valorRecuperacao informado vale para cada equipamento (GESTOR)",

    "GET /movimentacoes": "Lista as movimentações; filtros de período ou ano, status de destino, código do equipamento e responsável (id ou login) (GESTOR, AUDITOR)",

    "GET /painel": "Resumo com os números que interessam ao seu papel (todos)",
    "GET /relatorios/destinacao": "Kg por tipo de destinação e parceiro, de uma organização ou de todas (GESTOR, OPERADOR_CADASTRO, AUDITOR)",
    "GET /lotes/:id/certificado": "Baixa o certificado de destinação em PDF de um lote FINALIZADO (GESTOR, OPERADOR_CADASTRO, AUDITOR)",
    "GET /organizacoes/:id/certificado": "Baixa o certificado em PDF com os lotes da organização finalizados no período (GESTOR, OPERADOR_CADASTRO, AUDITOR)",
    "GET /relatorios/financeiro": "Receita, impostos e receita líquida por organização (AUDITOR)",

    "GET /auditoria": "Histórico de todas as alterações; filtros de período ou ano, tabela, registro e usuário (id ou login) (AUDITOR)",
    "GET /parametros": "Mostra alíquota, depreciação e dias de lote parado (AUDITOR)",
    "PATCH /parametros": "Altera os parâmetros globais (ADMINISTRADOR)",

    "GET /health": "Confere se o servidor está no ar (sem login)",
    "GET /": "Abre a documentação (Swagger)",

};

const hoje = new Date().toISOString().slice(0, 10);
const anoAtual = new Date().getFullYear();

export const exemplos: Record<string, object> = {
    "POST /auth/login": { login: "admin", senha: "Greencode1" },
    "PATCH /auth/senha": { senhaAtual: "Greencode1", novaSenha: "Admin2026" },

    "POST /usuarios": { nome: "Ana Souza", login: "ana.souza", senha: "Greencode1", papel: "OPERADOR_CADASTRO", departamentoId: ID_DEPARTAMENTO_EXEMPLO },
    "PATCH /usuarios/:id": { nome: "Ana Souza Lima", versao: 1 },
    "PATCH /usuarios/:id/senha": { novaSenha: "Greencode1" },

    "POST /departamentos": { nome: "Logística" },
    "PATCH /departamentos/:id": { nome: "Logística e Transporte", versao: 1 },

    "POST /organizacoes": {
        razaoSocial: "Mercado Bom Preço Ltda",
        cnpj: "11.222.333/0001-81",
        inscricaoEstadual: "123123123",
        enderecoCompleto: "Rua das Flores, 50 - São José dos Campos/SP",
        telefone: "(12) 3900-1000",
        email: "ti@bompreco.com.br",
    },
    "PATCH /organizacoes/:id": { telefone: "(12) 3900-2000", versao: 1 },
    "POST /organizacoes/:id/chaves-api": { permissoes: ["LER_RASTREABILIDADE", "GERENCIAR_LOTES", "GERAR_RELATORIOS", "ATUALIZAR_CADASTRO"], limitePorMinuto: 100, revogarAnteriorNaHora: false },

    "POST /relatorios/analiticos": { tipo: "VIDA_UTIL" },
    "POST /public/relatorios": {
        tipo: "VIDA_UTIL_INVENTARIO",
        itens: [
            { identificador: "PAT-0001", tipo: "NOTEBOOK", marca: "Dell", modelo: "Latitude 5490", anoFabricacao: 2019 },
            { identificador: "PAT-0002", tipo: "MONITOR", marca: "LG", modelo: "24MK430", anoFabricacao: 2021 },
            { identificador: "PAT-0003", tipo: "SERVIDOR", marca: "Dell", modelo: "PowerEdge R640", anoFabricacao: 2017 },
        ],
    },
    "PUT /public/webhook": { url: "https://techcorp.com.br/avisos/greencode" },
    "PATCH /public/conta": { telefone: "(12) 3900-5555", versao: 1 },
    "POST /public/lotes": {
        dataPrevistaChegada: hoje,
        notaFiscal: "NF-API-0001",
        transportadora: "TransLog",
        observacoes: "Enviado pelo sistema da TechCorp",
        equipamentos: [
            { tipo: "NOTEBOOK", marca: "Dell", modelo: "Latitude 5490", anoFabricacao: 2019, estadoFisico: "USADO_LEVE", pesoQuilogramas: 2.1 },
        ],
    },
    "PATCH /public/lotes/:id": { transportadora: "Rápido Sul", versao: 1 },
    "PATCH /lotes/:id/confirmar-recebimento": { versao: 1, dataEntrada: hoje },
    "PATCH /public/lotes/:id/cancelar": { versao: 1 },
    "POST /public/lotes/:id/equipamentos": { tipo: "MONITOR", marca: "LG", modelo: "24MK430", anoFabricacao: 2020, estadoFisico: "BOM_ESTADO", pesoQuilogramas: 3.4 },
    "PATCH /public/equipamentos/:codigo": { pesoQuilogramas: 2.4, versao: 1 },
    "PATCH /public/equipamentos/:codigo/cancelar": { versao: 1 },

    "POST /contratos": {
        organizacaoId: ID_DE_EXEMPLO,
        dataAssinatura: "2027-01-01",
        dataVencimento: "2027-12-31",
        clausulas: ["Coleta mensal de equipamentos", "Emissão de certificado de destinação"],
        valorMensal: 1500,
        renovacaoAutomatica: false,
    },
    "PATCH /contratos/:id": { valorMensal: 1800, versao: 1 },
    "PATCH /contratos/:id/renovar": { novoVencimento: "2028-12-31", versao: 1 },
    "PATCH /contratos/:id/encerrar": { versao: 1 },

    "POST /destinos": {
        razaoSocial: "Verde Ciclo Reciclagem Ltda",
        cnpj: "45.723.174/0001-10",
        enderecoCompleto: "Av. Industrial, 900 - Jacareí/SP",
        telefone: "(12) 3950-3000",
        email: "contato@verdeciclo.com.br",
    },
    "PATCH /destinos/:id": { telefone: "(12) 3950-4000", versao: 1 },

    "POST /lotes": {
        organizacaoId: ID_DE_EXEMPLO,
        dataEntrada: hoje,
        notaFiscal: "NF-3001",
        transportadora: "TransLog",
        observacoes: "Duas caixas",
        equipamentos: [
            {
                tipo: "NOTEBOOK",
                marca: "Dell",
                modelo: "Latitude 5400",
                anoFabricacao: 2020,
                estadoFisico: "USADO_LEVE",
                pesoQuilogramas: 1.8,
            },
        ],
    },
    "PATCH /lotes/:id": { observacoes: "Uma caixa chegou molhada", versao: 1 },
    "PATCH /lotes/:id/cancelar": { versao: 1 },
    "POST /lotes/:id/equipamentos": {
        tipo: "MONITOR",
        marca: "LG",
        modelo: "24MK430",
        anoFabricacao: 2019,
        estadoFisico: "BOM_ESTADO",
        pesoQuilogramas: 3.2,
    },

    "PATCH /equipamentos/:id": { marca: "Dell Technologies", versao: 1 },
    "PATCH /equipamentos/:id/avaliacao": { estadoFisico: "DANIFICADO_GRAVE", justificativa: "Tela trincada", versao: 1 },
    "POST /equipamentos/:id/movimentar": { novoStatus: "EM_TRIAGEM", versao: 1 },
    "POST /equipamentos/:id/falhas": { tipo: "BATERIA_VICIADA", gravidade: "MODERADA", descricao: "Bateria não segura carga por mais de 10 minutos" },
    "POST /falhas/:id/anular": { justificativa: "Registrada no equipamento errado", versao: 1 },
    "POST /equipamentos/:id/corrigir": { movimentacaoId: ID_DE_EXEMPLO, justificativa: "Era para reciclagem, não descarte", versao: 3 },
    "POST /equipamentos/codigo/:codigo/movimentar": { novoStatus: "EM_TRIAGEM", versao: 1 },
    "POST /equipamentos/movimentar-varios": { codigos: [`GC-${anoAtual}-000007`, `GC-${anoAtual}-000008`], novoStatus: "EM_TRIAGEM" },

    "PATCH /parametros": { diasLoteParado: 45, versao: 1 },
};
