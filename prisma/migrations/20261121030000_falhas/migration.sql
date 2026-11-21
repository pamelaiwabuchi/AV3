-- CreateEnum
CREATE TYPE "TipoFalha" AS ENUM ('NAO_LIGA', 'TELA_DANIFICADA', 'BATERIA_VICIADA', 'PLACA_MAE', 'ARMAZENAMENTO', 'MEMORIA', 'FONTE', 'SUPERAQUECIMENTO', 'CARCACA_QUEBRADA', 'TECLADO_PERIFERICOS', 'CONECTORES_PORTAS', 'OXIDACAO_CORROSAO', 'OUTRO');

-- CreateEnum
CREATE TYPE "GravidadeFalha" AS ENUM ('LEVE', 'MODERADA', 'GRAVE');

-- CreateTable
CREATE TABLE "Falha" (
    "id" UUID NOT NULL,
    "equipamentoId" UUID NOT NULL,
    "tipo" "TipoFalha" NOT NULL,
    "gravidade" "GravidadeFalha" NOT NULL,
    "descricao" TEXT,
    "dataRegistro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responsavelId" UUID NOT NULL,
    "anulada" BOOLEAN NOT NULL DEFAULT false,
    "justificativaAnulacao" TEXT,
    "dataAnulacao" TIMESTAMP(3),
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Falha_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Falha" ADD CONSTRAINT "Falha_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Falha" ADD CONSTRAINT "Falha_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Falha é auditada como as outras tabelas (quem registrou, quem anulou e quando).
CREATE TRIGGER auditoria_falha AFTER INSERT OR UPDATE OR DELETE ON "Falha"
    FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();
