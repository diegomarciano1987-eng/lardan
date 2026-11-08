-- 0266 (Daniel, 08/11/2026)
-- 1) Busca da maleta de abertura: a candidata cadastrada na rua já tem pessoa (party_id) mas ainda não tem
--    perfil de consultora; antes ela sumia das duas listas. Agora aparece como candidata até virar consultora.
--    Busca por partes do nome (da candidatura e do cadastro), protocolo, código e CPF.
CREATE OR REPLACE FUNCTION public.rep_maleta_destinatarias(_rep uuid, _busca text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t text := btrim(coalesce(_busca, ''));
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.tipo, x.nome) FROM (
    SELECT 'consultora' tipo, p.id::text id, p.display_name nome, p.code codigo,
           (SELECT a.city FROM party_addresses a WHERE a.party_id = p.id ORDER BY a.is_primary DESC LIMIT 1) cidade
      FROM consultant_profiles cp JOIN parties p ON p.id = cp.party_id
     WHERE cp.representative_party_id = _rep AND p.is_active AND p.status NOT IN ('inativo', 'bloqueado', 'desligado')
       AND public.consultora_termo_casa(p.id, p.display_name, p.code, p.doc_digits, t)
    UNION ALL
    SELECT DISTINCT ON (coalesce(l.party_id, l.id)) 'candidata', l.id::text, l.full_name, l.protocol, l.city
      FROM leads l LEFT JOIN parties p ON p.id = l.party_id
     WHERE l.representante_party_id = _rep AND l.archived_at IS NULL AND l.lost_at IS NULL
       AND (l.party_id IS NULL OR (
             NOT EXISTS (SELECT 1 FROM consultant_profiles cp2 WHERE cp2.party_id = l.party_id)
             AND coalesce(p.status, '') NOT IN ('bloqueado', 'desligado')))
       AND public.consultora_termo_casa(l.party_id, l.full_name || ' ' || coalesce(p.display_name, ''), l.protocol,
                                        coalesce(p.doc_digits, l.cpf_digits), t)
     ORDER BY coalesce(l.party_id, l.id), l.created_at DESC
     LIMIT 300) x), '[]'::jsonb);
END $function$;

-- 2) Tela da remessa: número da abertura (ABERTURA 01) e sequência da maleta da consultora na remessa
--    (MALETA 01; um acréscimo para a mesma consultora vira MALETA 02). Só acrescenta colunas.
DROP FUNCTION IF EXISTS public.remessa_maletas(uuid);
CREATE FUNCTION public.remessa_maletas(_remessa uuid)
 RETURNS TABLE(cycle_id uuid, consultora_party_id uuid, consultora text, status text, pecas integer, valor_cents bigint,
               created_at timestamp with time zone, abertura_numero integer, maleta_seq integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT k.id, k.consultora_party_id, pa.display_name, k.status::text, k.quantity_total, k.reference_total_cents::bigint, k.created_at,
         kc.abertura_numero,
         CASE WHEN k.consultora_party_id IS NULL THEN NULL
              ELSE (row_number() OVER (PARTITION BY k.consultora_party_id ORDER BY k.created_at, k.id))::int END
  FROM colab_v_kit_cycles k
  JOIN public.kit_cycles kc ON kc.id = k.id
  LEFT JOIN public.colab_v_parties pa ON pa.id = k.consultora_party_id
  WHERE (k.consultora_party_id IS NULL OR public.colab_party_ok(k.consultora_party_id)) AND k.remessa_id = _remessa AND k.status <> 'cancelada'
    AND public.kit_ve_rede()
  ORDER BY pa.display_name, kc.abertura_numero, k.created_at;
$function$;
REVOKE ALL ON FUNCTION public.remessa_maletas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remessa_maletas(uuid) TO authenticated, service_role;

-- 3) ZapSign: quando o aviso automático não chega, o servidor confere os pendentes em rodízio.
ALTER TABLE public.assinaturas_digitais ADD COLUMN IF NOT EXISTS conferido_em timestamptz;
COMMENT ON COLUMN public.assinaturas_digitais.conferido_em IS 'Última conferência ativa na ZapSign (rodízio da conferência automática).';

CREATE OR REPLACE FUNCTION public.assinaturas_pendentes_conferir(_limite integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r jsonb;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  WITH alvo AS (
    SELECT id FROM assinaturas_digitais
     WHERE status = 'pendente' AND doc_token IS NOT NULL AND criado_em > now() - interval '60 days'
     ORDER BY conferido_em NULLS FIRST, criado_em DESC
     LIMIT least(greatest(coalesce(_limite, 10), 1), 50)
     FOR UPDATE SKIP LOCKED
  ), marcados AS (
    UPDATE assinaturas_digitais a SET conferido_em = now() FROM alvo WHERE a.id = alvo.id
    RETURNING a.doc_token, a.party_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('doc_token', doc_token, 'party_id', party_id)), '[]'::jsonb) INTO r FROM marcados;
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.assinaturas_pendentes_conferir(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinaturas_pendentes_conferir(integer) TO service_role;

-- marca a conferência feita na hora pela tela (botão "Verificar se já assinou")
CREATE OR REPLACE FUNCTION public.assinatura_conferida(_doc_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  UPDATE assinaturas_digitais SET conferido_em = now() WHERE doc_token = _doc_token;
END $function$;
REVOKE ALL ON FUNCTION public.assinatura_conferida(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_conferida(text) TO service_role;
