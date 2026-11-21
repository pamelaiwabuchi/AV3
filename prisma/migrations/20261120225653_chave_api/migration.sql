-- CreateEnum
CREATE TYPE "PermissaoApi" AS ENUM ('LER_RASTREABILIDADE', 'ENVIAR_LOTES', 'GERAR_RELATORIOS');

-- CreateTable
CREATE TABLE "ChaveApi" (
    "id" UUID NOT NULL,
    "organizacaoId" UUID NOT NULL,
    "hashChave" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "permissoes" "PermissaoApi"[],
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ChaveApi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChaveApi_hashChave_key" ON "ChaveApi"("hashChave");

-- AddForeignKey
ALTER TABLE "ChaveApi" ADD CONSTRAINT "ChaveApi_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Função de auditoria atualizada: além do hashSenha, o hashChave (chave de API)
-- também nunca vai para a Auditoria. Segredo não vai para log; o "prefixo"
-- continua lá para identificar a chave.
CREATE OR REPLACE FUNCTION registrar_auditoria() RETURNS trigger AS $$
DECLARE
    usuario TEXT := NULLIF(current_setting('app.usuario_id', true), '');
    antes JSONB := NULL;
    depois JSONB := NULL;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        antes := to_jsonb(OLD);
    END IF;

    IF TG_OP <> 'DELETE' THEN
        depois := to_jsonb(NEW);
    END IF;

    -- A senha nunca vai para a auditoria: só registramos que ela mudou.
    IF (antes ->> 'hashSenha') IS DISTINCT FROM (depois ->> 'hashSenha') AND TG_OP = 'UPDATE' THEN
        depois := depois || '{"hashSenha": "(senha alterada)"}';
    ELSE
        depois := depois - 'hashSenha';
    END IF;

    antes := antes - 'hashSenha';

    -- O hash da chave de API também sai (novo na AV3).
    antes := antes - 'hashChave';
    depois := depois - 'hashChave';

    INSERT INTO "Auditoria" ("tabela", "operacao", "registroId", "usuarioId", "dadosAntes", "dadosDepois")
    VALUES (TG_TABLE_NAME, TG_OP, COALESCE(depois ->> 'id', antes ->> 'id')::uuid, usuario::uuid, antes, depois);

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ChaveApi é auditada, igual às outras tabelas.
CREATE TRIGGER auditoria_chave_api AFTER INSERT OR UPDATE OR DELETE ON "ChaveApi"
    FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();
