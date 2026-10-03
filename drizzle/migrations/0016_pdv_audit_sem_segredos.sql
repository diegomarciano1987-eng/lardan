CREATE OR REPLACE FUNCTION public.pdv_config_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb := to_jsonb(coalesce(NEW, OLD)) - 'senha_hash' - 'pin_hash'; u uuid;
BEGIN
  u := coalesce((r->>'unidade_id')::uuid, case when TG_TABLE_NAME='pdv_unidades' then (r->>'id')::uuid end,
       (select m.unidade_id from pdv_membros m where m.id=(r->>'membro_id')::uuid));
  INSERT INTO pdv_config_eventos(unidade_id,tabela,registro_id,acao,dados,autor_id) VALUES(u,TG_TABLE_NAME,(r->>'id')::uuid,TG_OP,r,auth.uid());
  RETURN coalesce(NEW, OLD);
END $$;
UPDATE public.pdv_config_eventos SET dados = dados - 'senha_hash' - 'pin_hash' WHERE dados ? 'senha_hash' OR dados ? 'pin_hash';