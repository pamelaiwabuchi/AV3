-- Tabelas da camada analítica. Não têm trigger de auditoria de propósito: são geradas
-- pelo sistema, nunca editadas, e o resultado em JSON é grande (a auditoria duplicaria
-- tudo). Quem pediu e quando já fica na própria linha (solicitadoPorId, dataPedido).

-- CreateEnum
CREATE TYPE "TipoRelatorio" AS ENUM ('EFICIENCIA', 'RENTABILIDADE', 'VIDA_UTIL', 'VIDA_UTIL_INVENTARIO');

-- CreateEnum
CREATE TYPE "OrigemRelatorio" AS ENUM ('INTERNO', 'API', 'AGENDADO');

-- CreateEnum
CREATE TYPE "StatusRelatorio" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'FALHOU');

-- CreateTable
CREATE TABLE "RelatorioGerado" (
    "id" UUID NOT NULL,
    "tipo" "TipoRelatorio" NOT NULL,
    "origem" "OrigemRelatorio" NOT NULL,
    "status" "StatusRelatorio" NOT NULL DEFAULT 'PENDENTE',
    "parametros" JSONB NOT NULL,
    "periodoInicio" DATE,
    "periodoFim" DATE,
    "organizacaoId" UUID,
    "solicitadoPorId" UUID,
    "dataPedido" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataConclusao" TIMESTAMP(3),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "resultado" JSONB,

    CONSTRAINT "RelatorioGerado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrevisaoVidaUtil" (
    "id" UUID NOT NULL,
    "relatorioId" UUID NOT NULL,
    "tipoEquipamento" "TipoEquipamento" NOT NULL,
    "amostras" INTEGER NOT NULL,
    "coeficienteAngular" DOUBLE PRECISION,
    "intercepto" DOUBLE PRECISION,
    "r2" DOUBLE PRECISION,
    "limiarInservivel" DOUBLE PRECISION,
    "vidaUtilPrevistaAnos" DOUBLE PRECISION,
    "vidaUtilContabilAnos" DOUBLE PRECISION,
    "dataPrevisao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrevisaoVidaUtil_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RelatorioGerado" ADD CONSTRAINT "RelatorioGerado_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelatorioGerado" ADD CONSTRAINT "RelatorioGerado_solicitadoPorId_fkey" FOREIGN KEY ("solicitadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrevisaoVidaUtil" ADD CONSTRAINT "PrevisaoVidaUtil_relatorioId_fkey" FOREIGN KEY ("relatorioId") REFERENCES "RelatorioGerado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
