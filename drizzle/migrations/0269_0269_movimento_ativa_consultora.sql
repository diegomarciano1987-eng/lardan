-- 0269 (Diego, 08/11/2026): qualquer movimento em nome de uma consultora inativa a ativa na hora.
-- Bloqueada/desligada nunca (decisão do financeiro); cadastro unificado (duplicado) nunca; nada é bloqueado
-- se a ativação falhar. Toda ativação fica no audit_logs com a origem e a dívida em aberto (informativa).

CREATE OR REPLACE FUNCTION public.consultora_ativar_por_movimento(_party uuid, _actor uuid, _origem text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st text; mudou boolean := false; n int;
BEGIN
  IF _party IS NULL THEN RETURN false; END IF;
  SELECT status::text INTO st FROM parties WHERE id = _party;
  IF st IS NULL OR st IN ('bloqueado', 'desligado') THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM party_roles WHERE party_id = _party AND role = 'consultora') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM party_unificacoes WHERE duplicada_id = _party) THEN RETURN false; END IF;
  IF st = 'inativo' THEN
    UPDATE parties SET status = 'ativo', is_active = true, updated_at = now() WHERE id = _party AND status::text = 'inativo';
    GET DIAGNOSTICS n = ROW_COUNT; mudou := n > 0;
  END IF;
  UPDATE party_roles SET status = 'ativo', updated_at = now()
   WHERE party_id = _party AND role = 'consultora' AND status::text = 'inativo';
  GET DIAGNOSTICS n = ROW_COUNT; mudou := mudou OR n > 0;
  IF mudou THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (coalesce(_actor, auth.uid()), 'consultora.ativada_movimento', 'parties', _party::text,
            jsonb_build_object('origem', _origem, 'status_anterior', st, 'divida_cents', public.party_divida_aberta(_party)));
  END IF;
  RETURN mudou;
END $$;
REVOKE ALL ON FUNCTION public.consultora_ativar_por_movimento(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultora_ativar_por_movimento(uuid, uuid, text) TO service_role;

-- Gatilho genérico: TG_ARGV[0] = coluna com a consultora. Nunca impede o movimento.
CREATE OR REPLACE FUNCTION public.tg_consultora_movimento_ativa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE novo jsonb := to_jsonb(NEW); pid uuid;
BEGIN
  pid := nullif(novo ->> TG_ARGV[0], '')::uuid;
  IF pid IS NULL THEN RETURN NEW; END IF;
  -- ignorados: maleta cancelada, troca do histórico SmallData, convite que não é de consultora
  IF TG_TABLE_NAME = 'kit_cycles' AND novo ->> 'status' = 'cancelada' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'qualidade_trocas' AND novo ->> 'origem' = 'legado_smalldata' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'access_invites' AND NOT ('consultora' = ANY (NEW.roles::text[])) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'kit_cycles'
     AND (to_jsonb(OLD) ->> 'status') IS NOT DISTINCT FROM (novo ->> 'status')
     AND (to_jsonb(OLD) ->> TG_ARGV[0]) IS NOT DISTINCT FROM (novo ->> TG_ARGV[0]) THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.consultora_ativar_por_movimento(pid, auth.uid(), TG_TABLE_NAME || ':' || lower(TG_OP));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ativação por movimento falhou (%): %', TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_consultora_movimento_ativa() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_movimento_ativa_consultora ON public.kit_cycles;
CREATE TRIGGER zz_movimento_ativa_consultora AFTER INSERT OR UPDATE OF status, consultora_party_id ON public.kit_cycles
  FOR EACH ROW EXECUTE FUNCTION public.tg_consultora_movimento_ativa('consultora_party_id');
DROP TRIGGER IF EXISTS zz_movimento_ativa_consultora ON public.sales_orders;
CREATE TRIGGER zz_movimento_ativa_consultora AFTER INSERT ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_consultora_movimento_ativa('consultora_party_id');
DROP TRIGGER IF EXISTS zz_movimento_ativa_consultora ON public.kit_pre_baixas;
CREATE TRIGGER zz_movimento_ativa_consultora AFTER INSERT ON public.kit_pre_baixas
  FOR EACH ROW EXECUTE FUNCTION public.tg_consultora_movimento_ativa('consultora_party_id');
DROP TRIGGER IF EXISTS zz_movimento_ativa_consultora ON public.kit_entradas;
CREATE TRIGGER zz_movimento_ativa_consultora AFTER INSERT ON public.kit_entradas
  FOR EACH ROW EXECUTE FUNCTION public.tg_consultora_movimento_ativa('consultora_party_id');
DROP TRIGGER IF EXISTS zz_movimento_ativa_consultora ON public.kit_signature_requests;
CREATE TRIGGER zz_movimento_ativa_consultora AFTER INSERT ON public.kit_signature_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_consultora_movimento_ativa('consultora_party_id');
DROP TRIGGER IF EXISTS zz_movimento_ativa_consultora ON public.qualidade_trocas;
CREATE TRIGGER zz_movimento_ativa_consultora AFTER INSERT ON public.qualidade_trocas
  FOR EACH ROW EXECUTE FUNCTION public.tg_consultora_movimento_ativa('consultora_party_id');
DROP TRIGGER IF EXISTS zz_movimento_ativa_consultora ON public.consultant_clients;
CREATE TRIGGER zz_movimento_ativa_consultora AFTER INSERT ON public.consultant_clients
  FOR EACH ROW EXECUTE FUNCTION public.tg_consultora_movimento_ativa('consultora_party_id');
DROP TRIGGER IF EXISTS zz_movimento_ativa_consultora ON public.rep_acerto_checklist;
CREATE TRIGGER zz_movimento_ativa_consultora AFTER INSERT ON public.rep_acerto_checklist
  FOR EACH ROW EXECUTE FUNCTION public.tg_consultora_movimento_ativa('consultora_party_id');
DROP TRIGGER IF EXISTS zz_movimento_ativa_consultora ON public.consultora_acerto_ajustes;
CREATE TRIGGER zz_movimento_ativa_consultora AFTER INSERT ON public.consultora_acerto_ajustes
  FOR EACH ROW EXECUTE FUNCTION public.tg_consultora_movimento_ativa('consultora_party_id');
DROP TRIGGER IF EXISTS zz_movimento_ativa_consultora ON public.access_invites;
CREATE TRIGGER zz_movimento_ativa_consultora AFTER INSERT ON public.access_invites
  FOR EACH ROW EXECUTE FUNCTION public.tg_consultora_movimento_ativa('party_id');

-- Cheque/cobrança do representante: é movimento, ativa (a dívida segue na cobrança e fica registrada).
CREATE OR REPLACE FUNCTION public.rep_reativar_checado(_party uuid, _actor uuid, _motivo text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  ok := public.rep_reativar_interno(_party, _actor, _motivo);
  RETURN public.consultora_ativar_por_movimento(_party, _actor, _motivo) OR ok;
END $$;
REVOKE ALL ON FUNCTION public.rep_reativar_checado(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Representante enxerga a carteira inteira para dar maleta (inativa vira ativa ao receber); bloqueada/desligada não.
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
    (SELECT 'consultora' tipo, p.id::text id, p.display_name nome, p.code codigo,
           (SELECT a.city FROM party_addresses a WHERE a.party_id = p.id ORDER BY a.is_primary DESC LIMIT 1) cidade
      FROM consultant_profiles cp JOIN parties p ON p.id = cp.party_id
     WHERE cp.representative_party_id = _rep AND p.status::text NOT IN ('bloqueado', 'desligado', 'rascunho')
       AND NOT EXISTS (SELECT 1 FROM party_unificacoes u WHERE u.duplicada_id = p.id)
       AND public.consultora_termo_casa(p.id, p.display_name, p.code, p.doc_digits, t)
     ORDER BY (p.status::text = 'ativo') DESC, p.display_name
     LIMIT 300)
    UNION ALL
    (SELECT DISTINCT ON (coalesce(l.party_id, l.id)) 'candidata', l.id::text, l.full_name, l.protocol, l.city
      FROM leads l LEFT JOIN parties p ON p.id = l.party_id
     WHERE l.representante_party_id = _rep AND l.archived_at IS NULL AND l.lost_at IS NULL
       AND (l.party_id IS NULL OR (
             NOT EXISTS (SELECT 1 FROM consultant_profiles cp2 WHERE cp2.party_id = l.party_id)
             AND coalesce(p.status::text, '') NOT IN ('bloqueado', 'desligado')))
       AND public.consultora_termo_casa(l.party_id, l.full_name || ' ' || coalesce(p.display_name, ''), l.protocol,
                                        coalesce(p.doc_digits, l.cpf_digits), t)
     ORDER BY coalesce(l.party_id, l.id), l.created_at DESC
     LIMIT 300)) x), '[]'::jsonb);
END $function$;

-- Montagem: a busca de consultora sem praça também acha inativa (ela é ativada ao receber a maleta).
CREATE OR REPLACE FUNCTION public.remessa_consultoras_sem_praca_busca(_remessa uuid, _search text)
 RETURNS TABLE(party_id uuid, display_name text, representante text, code text, cpf text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT cp.party_id, pa.display_name, rp.display_name, pa.code, public.cpf_mascarado(pa.doc)
  FROM remessas r
  JOIN consultant_profiles cp ON cp.praca_id IS NULL
   AND (cp.representative_party_id IS NULL OR cp.representative_party_id = r.representante_party_id)
  JOIN parties pa ON pa.id = cp.party_id AND pa.status NOT IN ('desligado','bloqueado','rascunho')
  LEFT JOIN parties rp ON rp.id = cp.representative_party_id
  WHERE r.id = _remessa AND public.can_manage_kits(auth.uid()) AND public.colab_party_ok(cp.party_id)
    AND _search IS NOT NULL AND length(btrim(_search)) >= 2
    AND NOT EXISTS (SELECT 1 FROM party_unificacoes u WHERE u.duplicada_id = pa.id)
    AND public.consultora_termo_casa(pa.id, pa.display_name, pa.code, pa.doc, _search)
  ORDER BY (upper(coalesce(pa.code,'')) = upper(btrim(_search))) DESC, pa.display_name LIMIT 30;
$function$;