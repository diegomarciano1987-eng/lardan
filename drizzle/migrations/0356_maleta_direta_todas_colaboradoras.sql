-- 0356 (Diego, 19/11/2026) — "Nova maleta" (maleta direta) para TODAS as colaboradoras, inclusive as de carteira.
-- Maleta direta não tem representante: é da operação geral. Toda colaboradora com módulo de maletas (kit.view/kit.manage)
-- vê e opera as remessas diretas (abrir, bipar, conferir, imprimir) e o cadastro da consultora dessas maletas.
-- O resto da carteira não muda: remessas/maletas de outro representante continuam fora.
-- Também: Relatório de acertos traz direta/praca_id/rep_id para os filtros (Geral, praça, representante).

CREATE OR REPLACE FUNCTION public.colab_direta_pode()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.colab_restrita()
     AND (coalesce(public.can_manage_kits(auth.uid()), false) OR coalesce(public.can_view_kits(auth.uid()), false))
$function$;
REVOKE ALL ON FUNCTION public.colab_direta_pode() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.colab_direta_pode() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.colab_rem_ids()
 RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(r.id), '{}') FROM remessas r
   WHERE r.representante_party_id = public.colab_rep()
      OR (r.direta AND r.representante_party_id IS NULL AND (SELECT public.colab_direta_pode()))
$function$;

CREATE OR REPLACE FUNCTION public.colab_rem_ok(_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT NOT public.colab_restrita() OR EXISTS (SELECT 1 FROM remessas r WHERE r.id = _id
    AND (r.representante_party_id = public.colab_rep()
      OR (r.direta AND r.representante_party_id IS NULL AND public.colab_direta_pode())))
$function$;

CREATE OR REPLACE FUNCTION public.colab_cycle_ids()
 RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(c.id), '{}') FROM kit_cycles c
   WHERE c.representante_party_id = public.colab_rep()
      OR EXISTS (SELECT 1 FROM remessas r WHERE r.id = c.remessa_id
                  AND (r.representante_party_id = public.colab_rep()
                    OR (r.direta AND r.representante_party_id IS NULL AND (SELECT public.colab_direta_pode()))))
$function$;

CREATE OR REPLACE FUNCTION public.colab_cycle_ok(_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT NOT public.colab_restrita() OR EXISTS (SELECT 1 FROM kit_cycles c WHERE c.id = _id
    AND (c.representante_party_id = public.colab_rep()
      OR EXISTS (SELECT 1 FROM remessas r WHERE r.id = c.remessa_id
                  AND (r.representante_party_id = public.colab_rep()
                    OR (r.direta AND r.representante_party_id IS NULL AND public.colab_direta_pode())))))
$function$;

-- Consultoras das maletas diretas entram no que a colaboradora enxerga (nome, código, contato), além da carteira.
CREATE OR REPLACE FUNCTION public.colab_direta_party_ids()
 RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(DISTINCT c.consultora_party_id), '{}')
    FROM kit_cycles c JOIN remessas r ON r.id = c.remessa_id
   WHERE (SELECT public.colab_direta_pode()) AND r.direta AND r.representante_party_id IS NULL
     AND c.status <> 'cancelada' AND c.consultora_party_id IS NOT NULL
$function$;
REVOKE ALL ON FUNCTION public.colab_direta_party_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.colab_direta_party_ids() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.colab_party_ids()
 RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(cp.party_id), '{}') FROM consultant_profiles cp
   WHERE cp.representative_party_id = public.colab_rep()
      OR cp.party_id = ANY ((SELECT public.colab_direta_party_ids())::uuid[])
$function$;

CREATE OR REPLACE FUNCTION public.colab_party_ok(_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT NOT public.colab_restrita()
      OR EXISTS (SELECT 1 FROM consultant_profiles cp WHERE cp.party_id = _id AND cp.representative_party_id = public.colab_rep())
      OR _id = ANY (public.colab_direta_party_ids())
$function$;

CREATE OR REPLACE VIEW public.colab_v_remessas AS
 SELECT id, numero, praca_id, representante_party_id, origin_location_id, data_emissao, data_acerto, status,
        observacoes, created_by, created_at, updated_at
   FROM remessas r
  WHERE (NOT (SELECT colab_restrita())) OR representante_party_id = (SELECT colab_rep())
     OR (direta AND representante_party_id IS NULL AND (SELECT colab_direta_pode()));

CREATE OR REPLACE VIEW public.colab_v_consultant_profiles AS
 SELECT party_id, origin, joined_at, representative_party_id, sponsor_party_id, region, wallet, level, goal_cents, cycle,
        sale_profile, experience, audience, availability, block_reason, pix_key_type, pix_key, pix_holder, pix_holder_doc,
        bank_info, credit_limit_cents, financial_status, restricted_notes, created_at, updated_at, referral_code,
        sponsor_set_at, sponsor_origin, praca_id
   FROM consultant_profiles cp
  WHERE (NOT (SELECT colab_restrita())) OR representative_party_id = (SELECT colab_rep())
     OR party_id = ANY ((SELECT colab_direta_party_ids())::uuid[]);

CREATE OR REPLACE VIEW public.colab_v_parties AS
 SELECT id, kind, code, display_name, legal_name, social_name, doc, doc_digits, doc_verified_at, rg, rg_issuer, birth_date,
        profession, marital_status, avatar_url, notes, status, is_active, created_by, updated_by, created_at, updated_at,
        doc_masked, doc_canon, doc_source, doc_checked_at
   FROM parties p
  WHERE (NOT (SELECT colab_restrita()))
     OR id IN (SELECT consultant_profiles.party_id FROM consultant_profiles
                WHERE consultant_profiles.representative_party_id = (SELECT colab_rep()))
     OR id = ANY ((SELECT colab_direta_party_ids())::uuid[]);

-- A trava de carteira deixa passar só a maleta direta (sem representante) aberta por quem tem o módulo de maletas.
CREATE OR REPLACE FUNCTION public.colab_operacao_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.colab_restrita() THEN
    IF TG_TABLE_NAME = 'remessas' THEN
      IF NEW.representante_party_id IS NULL AND public.colab_direta_pode()
         AND (NEW.direta OR current_setting('lardan.maleta_direta', true) = 'on') THEN
        RETURN NEW;
      END IF;
      IF NEW.representante_party_id IS DISTINCT FROM public.colab_rep() OR NOT public.colab_praca_ok(NEW.praca_id) THEN
        RAISE EXCEPTION 'Remessa fora da carteira.' USING errcode = '42501';
      END IF;
    ELSIF TG_TABLE_NAME = 'kit_cycles' THEN
      IF NEW.representante_party_id IS NULL AND public.colab_direta_pode()
         AND (current_setting('lardan.maleta_direta', true) = 'on'
              OR EXISTS (SELECT 1 FROM remessas r WHERE r.id = NEW.remessa_id AND r.direta AND r.representante_party_id IS NULL)) THEN
        RETURN NEW;
      END IF;
      IF NEW.representante_party_id IS DISTINCT FROM public.colab_rep()
         OR (NEW.consultora_party_id IS NOT NULL AND NOT public.colab_party_ok(NEW.consultora_party_id)) THEN
        RAISE EXCEPTION 'Maleta fora da carteira.' USING errcode = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- Nova maleta: liberada para toda colaboradora com kit.manage (antes: só equipe sem carteira).
CREATE OR REPLACE FUNCTION pg_temp.trocar(_fn regprocedure, _de text, _para text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE d text := pg_get_functiondef(_fn);
BEGIN
  IF position(_para IN d) > 0 THEN RETURN; END IF;
  IF position(_de IN d) = 0 THEN RAISE EXCEPTION '0356: trecho não encontrado em %', _fn; END IF;
  EXECUTE replace(d, _de, _para);
END $f$;
SELECT pg_temp.trocar('public.maleta_direta_responsaveis()'::regprocedure,
  'public.can_manage_kits(auth.uid()) AND NOT public.colab_restrita()', 'public.can_manage_kits(auth.uid()) /*0356*/');
SELECT pg_temp.trocar('public.maleta_direta_consultoras(text)'::regprocedure,
  'public.can_manage_kits(auth.uid()) AND NOT public.colab_restrita()', 'public.can_manage_kits(auth.uid()) /*0356*/');
SELECT pg_temp.trocar('public.maleta_direta_abrir(uuid,date,uuid,uuid,uuid,text,integer)'::regprocedure,
  'IF NOT public.can_manage_kits(auth.uid()) OR public.colab_restrita() THEN',
  'IF NOT public.can_manage_kits(auth.uid()) /*0356*/ THEN');
SELECT pg_temp.trocar('public.maleta_direta_abrir(uuid,date,uuid,uuid,uuid,text,integer)'::regprocedure,
  '  v_rem := public.remessa_criar(',
  '  PERFORM set_config(''lardan.maleta_direta'', ''on'', true);
  v_rem := public.remessa_criar(');
SELECT pg_temp.trocar('public.maleta_direta_abrir(uuid,date,uuid,uuid,uuid,text,integer)'::regprocedure,
  '  v := public.remessa_abrir_maleta(v_id, _consultora);',
  '  v := public.remessa_abrir_maleta(v_id, _consultora);
  PERFORM set_config(''lardan.maleta_direta'', '''', true);');

-- Relatório de acertos: chaves para filtrar por praça, por representante e "Geral" (maletas diretas).
CREATE OR REPLACE FUNCTION public.acertos_relatorio(_de date, _ate date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE res jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.kit_ve_rede() THEN
    RAISE EXCEPTION 'Sem permissão para ver os acertos.' USING errcode = '42501';
  END IF;
  IF _de IS NULL OR _ate IS NULL OR _ate < _de THEN RAISE EXCEPTION 'Período inválido.'; END IF;
  IF _ate - _de > 92 THEN RAISE EXCEPTION 'Escolha um período de até 3 meses.'; END IF;

  WITH lardan AS (
    SELECT 'lardan'::text AS fonte, k.code AS maleta, r.numero AS remessa, public.kit_data_acerto(c) AS acerto,
           c.consultora_party_id AS party_id, p.display_name AS consultora, p.code AS codigo,
           coalesce(pc.nome, 'Sem praça') AS praca,
           CASE WHEN coalesce(r.direta, false) THEN 'Maleta direta' ELSE coalesce(rp.display_name, 'Sem representante') END AS representante,
           c.quantity_total AS pecas, c.reference_total_cents AS valor_cents,
           CASE WHEN pb.id IS NULL THEN 'sem_pre_baixa' ELSE public.pre_baixa_situacao(pb) END AS situacao,
           (SELECT regexp_replace(cp.value, '\D', '', 'g') FROM contact_points cp WHERE cp.party_id = c.consultora_party_id
             AND cp.kind::text IN ('whatsapp', 'telefone') ORDER BY (cp.kind::text = 'whatsapp') DESC, cp.is_primary DESC LIMIT 1) AS telefone,
           (SELECT a.city || coalesce('/' || a.uf, '') FROM party_addresses a WHERE a.party_id = c.consultora_party_id ORDER BY a.is_primary DESC, a.created_at LIMIT 1) AS cidade,
           coalesce(r.direta, false) AS direta,
           r.praca_id::text AS praca_id,
           CASE WHEN coalesce(r.direta, false) THEN NULL ELSE rp.id::text END AS rep_id
      FROM kit_cycles c
      JOIN kits k ON k.id = c.kit_id
      JOIN parties p ON p.id = c.consultora_party_id
      LEFT JOIN remessas r ON r.id = c.remessa_id
      LEFT JOIN cob_pracas pc ON pc.id = r.praca_id
      LEFT JOIN parties rp ON rp.id = coalesce(r.representante_party_id, c.representante_party_id)
      LEFT JOIN kit_pre_baixas pb ON pb.cycle_id = c.id
     WHERE c.status IN ('expedida', 'transito', 'recebida', 'operacao', 'acerto')
       AND public.kit_data_acerto(c) BETWEEN _de AND _ate
       AND public.kit_cycle_in_scope(c.id)
  ), smalldata AS (
    SELECT 'smalldata'::text AS fonte, 'Kit ' || m.kit AS maleta, m.remessa AS remessa, lr.vencimento AS acerto,
           lc.party_id, coalesce(p.display_name, lc.nome) AS consultora, coalesce(p.code, m.codcli::text) AS codigo,
           coalesce(pc.nome, lp.nome, 'Praça ' || lr.praca) AS praca,
           coalesce(rpl.display_name, lrep.nome, 'Representante ' || lr.representante) AS representante,
           m.pecas_enviadas AS pecas, m.valor_enviado_cents AS valor_cents, 'smalldata'::text AS situacao,
           coalesce(nullif(regexp_replace(coalesce(lc.celular, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(lc.telefone, ''), '\D', '', 'g'), '')) AS telefone,
           nullif(concat_ws('/', nullif(lc.cidade, ''), nullif(lc.uf, '')), '') AS cidade,
           false AS direta,
           coalesce(pc.id::text, 'leg:' || lr.praca) AS praca_id,
           coalesce(rpl.id::text, 'leg:' || lr.representante) AS rep_id
      FROM legado_maletas m
      JOIN legado_remessas lr ON lr.numero = m.remessa
      LEFT JOIN legado_consultoras lc ON lc.codcli = m.codcli
      LEFT JOIN parties p ON p.id = lc.party_id
      LEFT JOIN legado_pracas lp ON lp.codigo = lr.praca
      LEFT JOIN cob_pracas pc ON pc.id = lp.praca_id
      LEFT JOIN legado_representantes lrep ON lrep.codigo = lr.representante
      LEFT JOIN parties rpl ON rpl.id = lrep.party_id
     WHERE m.tipo = 'remessa' AND m.fechamento IS NULL AND m.fechamento_smalldata IS NULL
       AND lr.vencimento BETWEEN _de AND _ate
       AND public.legado_maleta_na_rua(m.remessa, m.codcli)
       AND public.colab_legacy_rep_ok(lr.representante)
       AND NOT EXISTS (SELECT 1 FROM kit_cycles c2 JOIN remessas r2 ON r2.id = c2.remessa_id
                        WHERE r2.numero = m.remessa AND c2.consultora_party_id = lc.party_id AND c2.status <> 'cancelada')
  )
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.praca, x.representante, x.acerto, x.consultora), '[]'::jsonb) INTO res
    FROM (SELECT * FROM lardan UNION ALL SELECT * FROM smalldata) x;
  RETURN jsonb_build_object('de', _de, 'ate', _ate, 'gerado_em', now(), 'linhas', res);
END $function$;
REVOKE ALL ON FUNCTION public.acertos_relatorio(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acertos_relatorio(date, date) TO authenticated, service_role;

-- Lista de remessas: a praça vem da própria remessa (já escopada por colab_v_remessas); a direta pode ser de praça fora da carteira.
SELECT pg_temp.trocar('public.remessas_lista(text)'::regprocedure,
  'colab_v_cob_pracas p ON p.id = r.praca_id',
  'public.cob_pracas p ON p.id = r.praca_id /*0356*/');