CREATE OR REPLACE FUNCTION public.cob_celular_norm(_v text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN length(d) >= 12 AND left(d, 2) = '55' THEN substr(d, 3) ELSE d END
    FROM (SELECT ltrim(regexp_replace(coalesce(_v, ''), '\D', '', 'g'), '0') AS d) x
$$;
REVOKE ALL ON FUNCTION public.cob_celular_norm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_celular_norm(text) TO authenticated, service_role;

-- Contato que o Asaas usa: celular VÁLIDO primeiro (antes pegava o 1º número, mesmo fixo/errado).
CREATE OR REPLACE FUNCTION public.asaas_exec_contato(_party uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  select jsonb_build_object(
    'email', (select value from contact_points where party_id=_party and kind::text='email' and value ~ '@' order by is_primary desc, updated_at desc limit 1),
    'celular', coalesce(
      (select public.cob_celular_norm(value) from contact_points where party_id=_party and kind::text in ('whatsapp','telefone')
          and public.cob_celular_norm(value) ~ '^\d{2}9\d{8}$' order by (kind::text='whatsapp') desc, is_primary desc, updated_at desc limit 1),
      (select regexp_replace(value,'\D','','g') from contact_points where party_id=_party and kind::text in ('whatsapp','telefone')
          and length(regexp_replace(value,'\D','','g')) between 10 and 13 order by (kind::text='whatsapp') desc, is_primary desc, updated_at desc limit 1))
  );
$function$;

CREATE OR REPLACE FUNCTION public.cob_contatos_avisos(_parties uuid[])
 RETURNS TABLE(party_id uuid, email text, celular text, telefone_invalido text, cpf_ok boolean, asaas_vinculado boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  IF coalesce(array_length(_parties, 1), 0) > 2000 THEN RAISE EXCEPTION 'No máximo 2000 pessoas por consulta.'; END IF;
  RETURN QUERY
  SELECT p.id,
    (SELECT lower(trim(cp.value)) FROM contact_points cp WHERE cp.party_id = p.id AND cp.kind::text = 'email'
        AND trim(cp.value) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' ORDER BY cp.is_primary DESC, cp.updated_at DESC LIMIT 1),
    (SELECT public.cob_celular_norm(cp.value) FROM contact_points cp WHERE cp.party_id = p.id AND cp.kind::text IN ('whatsapp','telefone')
        AND public.cob_celular_norm(cp.value) ~ '^\d{2}9\d{8}$' ORDER BY (cp.kind::text = 'whatsapp') DESC, cp.is_primary DESC, cp.updated_at DESC LIMIT 1),
    (SELECT cp.value FROM contact_points cp WHERE cp.party_id = p.id AND cp.kind::text IN ('whatsapp','telefone')
        AND public.cob_celular_norm(cp.value) !~ '^\d{2}9\d{8}$' AND regexp_replace(cp.value, '\D', '', 'g') <> ''
        ORDER BY (cp.kind::text = 'whatsapp') DESC, cp.is_primary DESC, cp.updated_at DESC LIMIT 1),
    length(coalesce(p.doc_digits, '')) IN (11, 14),
    EXISTS (SELECT 1 FROM asaas_customers ac WHERE ac.party_id = p.id AND ac.match_status = 'vinculado')
  FROM parties p WHERE p.id = ANY (_parties);
END $$;
REVOKE ALL ON FUNCTION public.cob_contatos_avisos(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_contatos_avisos(uuid[]) TO authenticated, service_role;