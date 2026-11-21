// Respostas de exemplo e códigos de erro que aparecem no Swagger (/docs).
// Isto é só documentação: entra pelo "transform" do @fastify/swagger e não muda o que a
// API responde de verdade (um schema de resposta no Fastify também filtraria os campos).

const ID = "3f2b9c1e-7a44-4d8e-9b61-2c5d0e8a1f10";
const ID_ORGANIZACAO = "00000000-0000-4000-8000-000000000001";

function erro(descricao: string, mensagem: string) {
    return { description: descricao, content: { "application/json": { example: { erro: mensagem } } } };
}

function sucesso(descricao: string, exemplo: unknown) {
    return { description: descricao, content: { "application/json": { example: exemplo } } };
}

function arquivo(descricao: string, tipo: string) {
    return { description: descricao, content: { [tipo]: { schema: { type: "string", format: "binary" } } } };
}

// Cabeçalhos do limite de requisições, presentes em toda resposta da API pública.
const CABECALHOS_DO_LIMITE = {
    "x-ratelimit-limit": { description: "Requisições permitidas por minuto para a sua chave", schema: { type: "integer" } },
    "x-ratelimit-remaining": { description: "Quantas ainda restam neste minuto", schema: { type: "integer" } },
    "x-ratelimit-reset": { description: "Segundos até o contador zerar", schema: { type: "integer" } },
};

// ---------- erros comuns ----------

const ERRO_400 = erro("Dados inválidos (campo faltando, tipo errado, valor fora da lista)", "O campo \"tipo\" precisa ser um destes valores: EFICIENCIA, VIDA_UTIL_INVENTARIO");
const ERRO_401_CHAVE = erro("Chave de API ausente, inválida, revogada ou expirada (ou organização desativada)", "Chave de API inválida ou revogada");
const ERRO_403_CHAVE = erro("A chave não tem a permissão exigida por esta rota", "Esta chave de API não tem a permissão GERENCIAR_LOTES");
const ERRO_404 = erro("Não existe, ou é de outra organização (por segurança, as duas respostas são iguais)", "Lote não encontrado");
const ERRO_409_VERSAO = erro("Conflito: o registro mudou desde a sua consulta (versao diferente) ou valor repetido", "O lote foi alterado por outra pessoa. Recarregue e tente de novo");
const ERRO_422 = erro("Regra de negócio não permite a operação", "O lote está RECEBIDO: pela API, só dá para alterar lotes que ainda não chegaram (AGUARDANDO_RECEBIMENTO). Fale com a greencode");
const ERRO_429 = {
    description: "Limite de requisições por minuto atingido",
    headers: { "retry-after": { description: "Segundos para tentar de novo", schema: { type: "integer" } } },
    content: { "application/json": { example: { erro: "Limite de 100 requisições por minuto atingido. Tente de novo em 42 segundos" } } },
};

const ERRO_401_TOKEN = erro("Token ausente, inválido ou expirado (faça login de novo)", "Token ausente, inválido ou expirado");
const ERRO_403_PAPEL = erro("Seu papel não tem permissão para esta ação", "Você não tem permissão para esta ação");

// ---------- exemplos de sucesso das rotas públicas ----------

const LOTE = {
    id: ID,
    dataEntrada: null,
    dataPrevistaChegada: "2026-11-25T00:00:00.000Z",
    organizacaoId: ID_ORGANIZACAO,
    notaFiscal: "NF-API-0001",
    transportadora: "TransLog",
    statusProcessamento: "AGUARDANDO_RECEBIMENTO",
    dataStatus: "2026-11-20T14:02:11.000Z",
    observacoes: "Enviado pelo sistema da TechCorp",
    versao: 1,
    organizacao: { razaoSocial: "TechCorp Soluções Ltda", cnpj: "52601815000120" },
    equipamentos: [
        {
            id: "9a1d2f00-1b2c-4d3e-8f90-123456789abc",
            codigoBarrasInterno: "GC-2026-000412",
            tipo: "NOTEBOOK",
            marca: "Dell",
            modelo: "Latitude 5490",
            anoFabricacao: 2019,
            estadoFisico: "USADO_LEVE",
            justificativaAvaliacao: null,
            pesoQuilogramas: "2.1",
            loteId: ID,
            posicaoNoLote: 1,
            statusRastreamento: "AGUARDANDO_TRIAGEM",
            destinoId: null,
            versao: 1,
        },
    ],
    pesoTotalKg: 2.1,
};

const EQUIPAMENTO = {
    ...LOTE.equipamentos[0],
    statusRastreamento: "BAIXA_DEFINITIVA",
    estadoFisico: "DANIFICADO_LEVE",
    versao: 5,
    depreciacao: { taxaAnual: 20, idadeEmAnos: 7, percentual: 100 },
    historico: [
        { dataHora: "2026-10-02T09:00:00.000Z", origem: null, destino: "AGUARDANDO_TRIAGEM", observacao: "Entrada no lote" },
        { dataHora: "2026-10-03T14:20:00.000Z", origem: "AGUARDANDO_TRIAGEM", destino: "EM_TRIAGEM", observacao: null },
        { dataHora: "2026-10-05T10:05:00.000Z", origem: "EM_TRIAGEM", destino: "PECAS_REAPROVEITADAS", observacao: null },
        { dataHora: "2026-10-12T16:40:00.000Z", origem: "PECAS_REAPROVEITADAS", destino: "BAIXA_DEFINITIVA", observacao: null },
    ],
    falhas: [{ tipo: "BATERIA_VICIADA", gravidade: "MODERADA", dataRegistro: "2026-10-03T14:50:00.000Z" }],
};

const PEDIDO_DE_RELATORIO = {
    id: ID,
    tipo: "VIDA_UTIL_INVENTARIO",
    status: "PENDENTE",
    dataPedido: "2026-11-20T14:10:00.000Z",
    dataConclusao: null,
    tentativas: 0,
    erro: null,
    links: {
        status: `/api/v1/public/relatorios/${ID}`,
        downloadJson: `/api/v1/public/relatorios/${ID}/download?formato=json`,
        downloadCsv: `/api/v1/public/relatorios/${ID}/download?formato=csv`,
    },
};

const RESULTADO_DO_INVENTARIO = {
    totalDeEquipamentos: 2,
    vidaUtilEsgotada: 0,
    trocarEmAte1Ano: 1,
    coletasPrevistasPorAno: [{ ano: 2027, equipamentos: 1 }, { ano: 2035, equipamentos: 1 }],
    equipamentos: [
        { identificador: "PAT-0001", tipo: "NOTEBOOK", anoFabricacao: 2019, idadeAnos: 7, vidaUtilPrevistaAnos: 7.9, anosRestantes: 0.9, anoPrevistoInservivel: 2027, situacao: "TROCAR_EM_ATE_1_ANO" },
        { identificador: "PAT-0002", tipo: "MONITOR", anoFabricacao: 2022, idadeAnos: 4, vidaUtilPrevistaAnos: 12.4, anosRestantes: 8.4, anoPrevistoInservivel: 2035, situacao: "EM_USO_NORMAL" },
    ],
};

// Para cada rota pública: a resposta de sucesso e os erros que ela pode dar.
// 401 e 429 valem para todas e são acrescentados automaticamente.
const RESPOSTAS_PUBLICAS: Record<string, Record<string, object>> = {
    "GET /public/conta": {
        200: sucesso("Dados da organização e da chave", {
            organizacao: { id: ID_ORGANIZACAO, razaoSocial: "TechCorp Soluções Ltda", cnpj: "52601815000120", telefone: "(12) 3333-4444", email: "ti@techcorp.com.br", ativo: true, versao: 1, webhookUrl: null, temContratoVigente: true },
            chave: { prefixo: "gc_exem", permissoes: ["LER_RASTREABILIDADE", "GERENCIAR_LOTES", "GERAR_RELATORIOS", "ATUALIZAR_CADASTRO"] },
        }),
    },
    "PATCH /public/conta": { 200: sucesso("Organização com os dados novos (versao aumenta)", { id: ID_ORGANIZACAO, telefone: "(12) 3900-5555", versao: 2 }), 400: ERRO_400, 403: ERRO_403_CHAVE, 409: ERRO_409_VERSAO },
    "GET /public/lotes": { 200: sucesso("Lotes da organização, 20 por página", { itens: [{ ...LOTE, equipamentos: undefined }], pagina: 1, totalPaginas: 2, total: 30 }), 400: ERRO_400, 403: ERRO_403_CHAVE },
    "GET /public/lotes/:id": { 200: sucesso("Lote com os equipamentos", LOTE), 400: ERRO_400, 403: ERRO_403_CHAVE, 404: ERRO_404 },
    "POST /public/lotes": {
        201: sucesso("Aviso de envio registrado: lote AGUARDANDO_RECEBIMENTO, com o código de barras de cada equipamento", LOTE),
        400: ERRO_400,
        403: ERRO_403_CHAVE,
        409: erro("Já existe lote (não cancelado) desta organização com essa nota fiscal", "Esta organização já tem um lote com a nota fiscal NF-API-0001"),
        422: erro("Organização sem contrato vigente, ano de fabricação no futuro etc.", "A organização não tem contrato vigente"),
    },
    "PATCH /public/lotes/:id": { 200: sucesso("Lote alterado", { ...LOTE, transportadora: "Rápido Sul", versao: 2 }), 400: ERRO_400, 403: ERRO_403_CHAVE, 404: ERRO_404, 409: ERRO_409_VERSAO, 422: ERRO_422 },
    "PATCH /public/lotes/:id/cancelar": { 200: sucesso("Lote e equipamentos cancelados", { ...LOTE, statusProcessamento: "CANCELADO", versao: 2 }), 403: ERRO_403_CHAVE, 404: ERRO_404, 409: ERRO_409_VERSAO, 422: ERRO_422 },
    "POST /public/lotes/:id/equipamentos": { 201: sucesso("Lote com o equipamento novo", LOTE), 400: ERRO_400, 403: ERRO_403_CHAVE, 404: ERRO_404, 422: ERRO_422 },
    "GET /public/lotes/:id/certificado": { 200: arquivo("Certificado de destinação final em PDF", "application/pdf"), 403: ERRO_403_CHAVE, 404: ERRO_404, 422: erro("O lote ainda não foi finalizado", "Só é possível emitir o certificado de um lote FINALIZADO (este está EM_TRIAGEM)") },
    "GET /public/equipamentos/:codigo": { 200: sucesso("Situação, histórico e falhas (laudo) do equipamento", EQUIPAMENTO), 403: ERRO_403_CHAVE, 404: erro("Código não existe ou é de outra organização", "Nenhum equipamento com o código GC-2026-000999") },
    "PATCH /public/equipamentos/:codigo": { 200: sucesso("Equipamento alterado", { ...LOTE.equipamentos[0], pesoQuilogramas: "2.4", versao: 2 }), 400: ERRO_400, 403: ERRO_403_CHAVE, 404: ERRO_404, 409: ERRO_409_VERSAO, 422: ERRO_422 },
    "PATCH /public/equipamentos/:codigo/cancelar": { 200: sucesso("Equipamento cancelado (removido do lote)", { ...LOTE.equipamentos[0], statusRastreamento: "CANCELADO", versao: 2 }), 403: ERRO_403_CHAVE, 404: ERRO_404, 409: ERRO_409_VERSAO, 422: erro("Lote já recebido, ou é o último equipamento ativo (cancele o lote)", "Este é o último equipamento ativo do lote. Para cancelar todos, cancele o lote") },
    "GET /public/certificado": { 200: arquivo("Certificado em PDF com os lotes finalizados no período", "application/pdf"), 400: ERRO_400, 403: ERRO_403_CHAVE, 422: erro("Nenhum lote finalizado no período", "Esta organização não tem nenhum lote finalizado nesse período") },
    "GET /public/resumo": {
        200: sucesso("Lotes por status e destinação no período", {
            lotesPorStatus: { AGUARDANDO_RECEBIMENTO: 1, RECEBIDO: 1, EM_TRIAGEM: 1, FINALIZADO: 26 },
            destinacao: { totalEquipamentos: 209, kgTotal: 1222.45, porDestinacao: { PECAS_REAPROVEITADAS: { quantidade: 88, kg: 503.23 }, MATERIAL_RECICLAVEL: { quantidade: 60, kg: 340.37 }, DESCARTE_SEGURO: { quantidade: 61, kg: 378.85 } } },
        }),
        400: ERRO_400,
        403: ERRO_403_CHAVE,
    },
    "POST /public/relatorios": {
        202: { ...sucesso("Pedido aceito e colocado na fila. Consulte o status no link (ou aguarde o webhook)", PEDIDO_DE_RELATORIO), headers: { location: { description: "Endereço para consultar o status", schema: { type: "string" } } } },
        400: ERRO_400,
        403: ERRO_403_CHAVE,
        422: erro("Pedido incompleto (ex.: inventário sem itens)", "Envie a lista de equipamentos (itens) para a previsão do inventário"),
        503: erro("A fila de processamento está fora do ar; tente mais tarde", "A fila de processamento está indisponível no momento. Tente de novo em alguns minutos"),
    },
    "GET /public/relatorios": { 200: sucesso("Pedidos da organização, do mais novo para o mais antigo", { itens: [{ ...PEDIDO_DE_RELATORIO, status: "CONCLUIDO", dataConclusao: "2026-11-20T14:10:03.000Z", tentativas: 1 }], pagina: 1, totalPaginas: 1, total: 1 }), 403: ERRO_403_CHAVE },
    "GET /public/relatorios/:id": {
        200: sucesso("Status do pedido; com CONCLUIDO, o resultado vem junto. FALHOU traz o erro", { ...PEDIDO_DE_RELATORIO, status: "CONCLUIDO", dataConclusao: "2026-11-20T14:10:03.000Z", tentativas: 1, resultado: RESULTADO_DO_INVENTARIO }),
        403: ERRO_403_CHAVE,
        404: erro("Não existe ou foi pedido por outra organização", "Relatório não encontrado"),
    },
    "GET /public/relatorios/:id/download": {
        200: {
            description: "Arquivo do relatório: JSON (completo) ou CSV (tabela principal, separador ; e vírgula decimal, abre no Excel)",
            content: { "application/json": { example: RESULTADO_DO_INVENTARIO }, "text/csv": { example: "identificador;tipo;marca;modelo;anoFabricacao;idadeAnos;vidaUtilPrevistaAnos;anosRestantes;anoPrevistoInservivel;situacao\nPAT-0001;NOTEBOOK;;;2019;7;7,9;0,9;2027;TROCAR_EM_ATE_1_ANO" } },
        },
        403: ERRO_403_CHAVE,
        404: erro("Não existe ou foi pedido por outra organização", "Relatório não encontrado"),
        409: erro("Ainda não ficou pronto (PENDENTE ou PROCESSANDO) ou falhou", "O relatório ainda não está pronto (status PROCESSANDO)"),
    },
    "GET /public/webhook": { 200: sucesso("Endereço cadastrado", { url: "https://techcorp.com.br/avisos/greencode", configurado: true }), 403: ERRO_403_CHAVE },
    "PUT /public/webhook": {
        200: sucesso("Webhook cadastrado; guarde o segredo", { url: "https://techcorp.com.br/avisos/greencode", segredo: "whsec_5ba65cf338103d34c3c06e8932fe751378d0382fc7b1b221", aviso: "Guarde o segredo: ele não aparece de novo..." }),
        400: ERRO_400,
        403: ERRO_403_CHAVE,
        422: erro("Endereço sem https", "O endereço do webhook precisa começar com https://"),
    },
    "DELETE /public/webhook": { 200: sucesso("Webhook removido", { url: null, configurado: false }), 403: ERRO_403_CHAVE },
};

// Rotas internas: os erros típicos pelo formato da rota (com :id pode dar 404, PATCH com
// versão pode dar 409, gravações podem dar 422). 200 fica com a resposta padrão.
function respostasInternas(metodo: string, caminho: string) {
    const respostas: Record<string, object> = { 400: ERRO_400, 401: ERRO_401_TOKEN, 403: ERRO_403_PAPEL };

    if (caminho.includes(":")) {
        respostas[404] = erro("Registro não encontrado", "Registro não encontrado");
    }

    if (metodo === "PATCH") {
        respostas[409] = ERRO_409_VERSAO;
    }

    if (metodo !== "GET") {
        respostas[422] = erro("Regra de negócio não permite a operação", "Só é possível editar um lote AGUARDANDO_RECEBIMENTO ou RECEBIDO");
    }

    return respostas;
}

function respostasPublicas(chave: string) {
    const respostas: Record<string, object> = { 401: ERRO_401_CHAVE, 429: ERRO_429, ...(RESPOSTAS_PUBLICAS[chave] ?? {}) };

    // O sucesso (2xx) mostra também os cabeçalhos do limite de requisições.
    for (const [codigo, resposta] of Object.entries(respostas)) {
        if (codigo.startsWith("2")) {
            respostas[codigo] = { ...resposta, headers: { ...CABECALHOS_DO_LIMITE, ...((resposta as { headers?: object }).headers ?? {}) } };
        }
    }

    return respostas;
}

// chave no formato "GET /public/lotes" ou "GET /lotes" (caminho curto, sem o prefixo).
export function respostasDaRota(metodo: string, caminho: string, ehPublica: boolean) {
    const chave = `${metodo} ${caminho}`;
    return ehPublica ? respostasPublicas(chave) : respostasInternas(metodo, caminho);
}

// ---------- descrição de cada parâmetro e campo ----------

// Dicionário único: o mesmo nome de campo tem a mesma explicação em todas as rotas.
export const DESCRICOES_DOS_CAMPOS: Record<string, string> = {
    id: "Id (UUID) do registro",
    codigo: "Código de barras interno do equipamento, no formato GC-AAAA-000001",
    pagina: "Número da página (começa em 1)",
    status: "Filtra pelo status",
    inicio: "Data inicial do período, no formato AAAA-MM-DD",
    fim: "Data final do período (incluída), no formato AAAA-MM-DD",
    formato: "json (resultado completo) ou csv (tabela principal, abre no Excel)",
    versao: "Versão do registro que você consultou (controle de concorrência): se alguém alterou antes, a resposta é 409",
    tipo: "Tipo (lista de valores permitidos ao lado)",
    notaFiscal: "Número da nota fiscal do envio; não pode repetir na mesma organização",
    transportadora: "Nome da transportadora",
    observacoes: "Observações livres (null apaga)",
    dataPrevistaChegada: "Data prevista para o lote chegar à greencode (AAAA-MM-DD)",
    equipamentos: "Equipamentos do lote (pelo menos 1)",
    itens: "Equipamentos que a organização ainda usa (até 5000), para a previsão de vida útil",
    identificador: "Seu código para o equipamento (patrimônio, por exemplo); volta igual no resultado",
    marca: "Marca do equipamento",
    modelo: "Modelo do equipamento",
    anoFabricacao: "Ano de fabricação (não pode ser no futuro)",
    estadoFisico: "Estado físico declarado (a greencode confirma na triagem)",
    pesoQuilogramas: "Peso em quilogramas (maior que zero)",
    telefone: "Telefone de contato",
    email: "E-mail de contato (recebe certificados e avisos)",
    enderecoCompleto: "Endereço completo",
    url: "Endereço https do seu sistema que recebe o aviso (POST com JSON assinado)",
    permissoes: "Permissões da chave, conforme o contrato",
    limitePorMinuto: "Requisições por minuto permitidas para a chave (padrão 100)",
    revogarAnteriorNaHora: "true se houver suspeita de vazamento: a chave anterior para na hora (senão, vale mais 24 h)",
    organizacaoId: "Id da organização",
    justificativa: "Motivo (obrigatório)",
    gravidade: "Gravidade da falha: LEVE, MODERADA ou GRAVE",
    descricao: "Descrição livre (obrigatória quando o tipo é OUTRO)",
    valorRecuperacao: "Quanto o parceiro de destino pagou, em reais (obrigatório para PECAS_REAPROVEITADAS e MATERIAL_RECICLAVEL)",
    destinoId: "Id do parceiro de destino (obrigatório para PECAS_REAPROVEITADAS, MATERIAL_RECICLAVEL e DESCARTE_SEGURO)",
    novoStatus: "Status para onde o equipamento vai",
};

interface Esquema {
    description?: string;
    properties?: Record<string, Esquema>;
    items?: Esquema;
}

// Coloca a descrição do dicionário nos campos que ainda não têm (também dentro de listas).
export function descreverCampos(esquema: Esquema | undefined) {
    if (!esquema) {
        return;
    }

    for (const [nome, campo] of Object.entries(esquema.properties ?? {})) {
        const descricao = DESCRICOES_DOS_CAMPOS[nome];

        if (!campo.description && descricao) {
            campo.description = descricao;
        }

        descreverCampos(campo);
    }

    descreverCampos(esquema.items);
}
