-- Valor de recuperação: quanto o parceiro de destino pagou pelo equipamento.
-- Vazio até o gestor mandar o equipamento para PECAS_REAPROVEITADAS, MATERIAL_RECICLAVEL
-- ou DESCARTE_SEGURO. Usado no relatório de rentabilidade.
ALTER TABLE "Equipamento" ADD COLUMN "valorRecuperacao" DECIMAL(12,2);
