CREATE INDEX IF NOT EXISTS parties_nome_norm_ativo ON public.parties (public.asaas_nome_norm(display_name)) WHERE is_active;
CREATE INDEX IF NOT EXISTS parties_doc_digits_ativo ON public.parties (doc_digits) WHERE is_active;

-- 0380: com _party informado, só confere as cobranças cujo CPF ou nome batem com essa ficha (antes varria tudo a cada cadastro novo).
CREATE OR REPLACE FUNCTION public.asaas_mesa_identificar_nucleo(_party uuid DEFAULT NULL::uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r record; alvo uuid; n int := 0; pdoc text; pnome text;
BEGIN
  IF _party IS NOT NULL THEN
    SELECT doc_digits, public.asaas_nome_norm(display_name) INTO pdoc, pnome FROM parties WHERE id = _party AND is_active;
    IF pdoc IS NULL AND pnome IS NULL THEN RETURN 0; END IF;
  END IF;
  FOR r IN
    SELECT * FROM (
      SELECT c.id, c.external_id, regexp_replace(coalesce(cu.doc,''),'\D','','g') doc,
             public.asaas_nome_norm(coalesce(cu.name, public.asaas_nome_pix(c.external_id))) nome
        FROM asaas_charges c
        LEFT JOIN asaas_customers cu ON cu.account_id=c.account_id AND cu.external_id=c.customer_external_id
       WHERE c.party_id IS NULL AND c.installment_id IS NULL AND c.title_id IS NULL AND c.external_status='RECEIVED') q
     WHERE _party IS NULL OR (pdoc IS NOT NULL AND q.doc = pdoc) OR (pnome IS NOT NULL AND q.nome = pnome)
  LOOP
    alvo := NULL;
    IF length(r.doc) IN (11,14) THEN
      SELECT CASE WHEN count(*)=1 THEN min(p.id::text)::uuid END INTO alvo FROM parties p WHERE p.doc_digits = r.doc AND p.is_active;
    END IF;
    IF alvo IS NULL AND r.nome IS NOT NULL AND position(' ' in r.nome) > 0 THEN
      SELECT CASE WHEN count(*)=1 THEN min(p.id::text)::uuid END INTO alvo FROM parties p
       WHERE p.is_active AND public.asaas_nome_norm(p.display_name) = r.nome;
    END IF;
    IF alvo IS NOT NULL AND (_party IS NULL OR alvo = _party) THEN
      UPDATE asaas_charges SET party_id = alvo,
             reconcile_note = coalesce(reconcile_note || ' | ','') || 'Cliente reconhecido pelo ' || CASE WHEN length(r.doc) IN (11,14) THEN 'CPF/nome' ELSE 'nome do Pix' END
       WHERE id = r.id AND party_id IS NULL;
      INSERT INTO audit_logs(actor_id, action, entity, entity_id, payload)
      VALUES (auth.uid(), 'asaas_mesa_identificar', 'asaas_charges', r.id::text, jsonb_build_object('party_id', alvo, 'external_id', r.external_id));
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $function$;