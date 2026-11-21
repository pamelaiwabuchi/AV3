-- Lote enviado pela API nasce AGUARDANDO_RECEBIMENTO: o parceiro avisou, mas os
-- equipamentos ainda não chegaram. O gestor confirma o recebimento depois.
ALTER TYPE "StatusLote" ADD VALUE 'AGUARDANDO_RECEBIMENTO' BEFORE 'RECEBIDO';

-- A data de entrada fica vazia até a confirmação; a data prevista é do parceiro.
ALTER TABLE "Lote" ALTER COLUMN "dataEntrada" DROP NOT NULL;
ALTER TABLE "Lote" ADD COLUMN "dataPrevistaChegada" DATE;

-- Permissões com nomes que dizem o que liberam: GERENCIAR_LOTES (enviar, editar e
-- cancelar) e ATUALIZAR_CADASTRO (dados de contato). RENAME mantém as chaves que já existem.
ALTER TYPE "PermissaoApi" RENAME VALUE 'ENVIAR_LOTES' TO 'GERENCIAR_LOTES';
ALTER TYPE "PermissaoApi" ADD VALUE 'ATUALIZAR_CADASTRO';

-- Limite por chave (conforme o contrato) e período de transição ao trocar a chave.
ALTER TABLE "ChaveApi" ADD COLUMN "limitePorMinuto" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "ChaveApi" ADD COLUMN "expiraEm" TIMESTAMP(3);
