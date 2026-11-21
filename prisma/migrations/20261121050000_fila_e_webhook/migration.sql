-- Webhook do parceiro (endereço e segredo da assinatura) e registro da entrega do aviso.
ALTER TABLE "Organizacao" ADD COLUMN "webhookUrl" TEXT;
ALTER TABLE "Organizacao" ADD COLUMN "webhookSegredo" TEXT;
ALTER TABLE "RelatorioGerado" ADD COLUMN "webhookEntregueEm" TIMESTAMP(3);
ALTER TABLE "RelatorioGerado" ADD COLUMN "webhookErro" TEXT;

-- Função de auditoria: o segredo do webhook também é segredo, então não vai para a
-- Auditoria (fica só a marca de que mudou), igual ao hashSenha e ao hashChave.
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

    -- O hash da chave de API também sai.
    antes := antes - 'hashChave';
    depois := depois - 'hashChave';

    -- O segredo do webhook também sai (novo no passo 6): só a marca de que mudou.
    IF (antes ->> 'webhookSegredo') IS DISTINCT FROM (depois ->> 'webhookSegredo') AND TG_OP = 'UPDATE' THEN
        depois := (depois - 'webhookSegredo') || '{"webhookSegredo": "(segredo alterado)"}';
    ELSE
        depois := depois - 'webhookSegredo';
    END IF;

    antes := antes - 'webhookSegredo';

    INSERT INTO "Auditoria" ("tabela", "operacao", "registroId", "usuarioId", "dadosAntes", "dadosDepois")
    VALUES (TG_TABLE_NAME, TG_OP, COALESCE(depois ->> 'id', antes ->> 'id')::uuid, usuario::uuid, antes, depois);

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
