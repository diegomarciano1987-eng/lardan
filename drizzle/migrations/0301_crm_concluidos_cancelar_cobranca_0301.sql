-- 0301 — CRM "Concluídos", cancelar cobrança no Asaas pela ficha do título e atalhos do cockpit.

CREATE OR REPLACE FUNCTION public.crm_lead_maleta(_l public.leads)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object('cycle_id', kc.id, 'maleta', k.code, 'situacao', kc.status, 'em', kc.created_at, 'party_id', kc.consultora_party_id)
    FROM public.kit_cycles kc JOIN public.kits k ON k.id = kc.kit_id
   WHERE kc.status::text <> 'cancelada'
     AND (kc.consultora_party_id = _l.party_id
          OR (_l.party_id IS NULL AND nullif(_l.cpf_digits, '') IS NOT NULL
              AND kc.consultora_party_id IN (SELECT p.id FROM public.parties p WHERE p.doc_digits = _l.cpf_digits)))
   ORDER BY kc.created_at
   LIMIT 1
$function$;
REVOKE ALL ON FUNCTION public.crm_lead_maleta(public.leads) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_filtrar(_f jsonb)
 RETURNS TABLE(id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.id
  FROM public.leads l
  WHERE (coalesce(_f->>'arquivadas','false')::boolean OR l.archived_at IS NULL)
    AND ((coalesce(_f->>'concluidas','false')::boolean) = (public.crm_lead_maleta(l) IS NOT NULL))
    AND (coalesce(_f->>'q','') = '' OR (
         l.full_name ILIKE '%'||(_f->>'q')||'%'
      OR l.whatsapp_norm LIKE '%'||regexp_replace(_f->>'q','\D','','g')||'%'
      OR coalesce(l.email_norm,'') LIKE '%'||lower(_f->>'q')||'%'
      OR l.city ILIKE '%'||(_f->>'q')||'%'
      OR l.protocol ILIKE '%'||(_f->>'q')||'%'))
    AND (coalesce(_f->>'etapa','') = '' OR l.stage_id = (_f->>'etapa')::uuid)
    AND (coalesce(_f->>'desfecho','') = '' OR l.outcome = _f->>'desfecho')
    AND (coalesce(_f->>'prioridade','') = '' OR l.priority = _f->>'prioridade')
    AND (coalesce(_f->>'responsavel','') = ''
         OR (_f->>'responsavel' = 'sem' AND l.assigned_to IS NULL)
         OR (_f->>'responsavel' = 'meu' AND l.assigned_to = auth.uid())
         OR (_f->>'responsavel' NOT IN ('sem','meu') AND l.assigned_to = (_f->>'responsavel')::uuid))
    AND (coalesce(_f->>'origem','') = '' OR l.source_normalized = _f->>'origem')
    AND (coalesce(_f->>'campanha','') = '' OR coalesce(l.utm->>'utm_campaign','') = _f->>'campanha')
    AND (coalesce(_f->>'cidade','') = '' OR l.city ILIKE _f->>'cidade')
    AND (coalesce(_f->>'uf','') = '' OR l.uf = upper(_f->>'uf'))
    AND (coalesce(_f->>'de','') = '' OR l.created_at >= (_f->>'de')::timestamptz)
    AND (coalesce(_f->>'ate','') = '' OR l.created_at < ((_f->>'ate')::date + 1)::timestamptz)
    AND (coalesce(_f->>'tag','') = '' OR EXISTS (
          SELECT 1 FROM public.candidatura_tag_links tl
           WHERE tl.lead_id = l.id AND tl.tag_id = (_f->>'tag')::uuid))
    AND (coalesce(_f->>'followup','') = ''
         OR (_f->>'followup' = 'atrasado'  AND l.next_followup_at < now())
         OR (_f->>'followup' = 'hoje'      AND l.next_followup_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
                                           AND l.next_followup_at <  (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day') AT TIME ZONE 'America/Sao_Paulo')
         OR (_f->>'followup' = 'proximas'  AND l.next_followup_at BETWEEN now() AND now() + interval '4 hours')
         OR (_f->>'followup' = 'sem'       AND l.next_followup_at IS NULL AND l.outcome = 'aberta')
         OR (_f->>'followup' = 'novas'     AND l.first_response_at IS NULL AND l.outcome = 'aberta'));
$function$;

CREATE OR REPLACE FUNCTION public.crm_radar()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d0 timestamptz := (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo';
BEGIN
  PERFORM public.crm_require('candidaturas.view');
  RETURN (
    SELECT jsonb_build_object(
      'atrasados',    count(*) FILTER (WHERE l.next_followup_at < now()),
      'hoje',         count(*) FILTER (WHERE l.next_followup_at >= d0 AND l.next_followup_at < d0 + interval '1 day'),
      'proximas',     count(*) FILTER (WHERE l.next_followup_at BETWEEN now() AND now() + interval '4 hours'),
      'sem_acao',     count(*) FILTER (WHERE l.next_followup_at IS NULL AND l.outcome = 'aberta'),
      'novas',        count(*) FILTER (WHERE l.first_response_at IS NULL AND l.outcome = 'aberta'),
      'sem_responsavel', count(*) FILTER (WHERE l.assigned_to IS NULL AND l.outcome = 'aberta'),
      'total',        count(*),
      'concluidas',   (SELECT count(*) FROM public.leads c WHERE c.archived_at IS NULL AND public.crm_lead_maleta(c) IS NOT NULL)
    )
    FROM public.leads l WHERE l.archived_at IS NULL AND public.crm_lead_maleta(l) IS NULL
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.crm_card(_l leads)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', _l.id,
    'protocolo', _l.protocol,
    'nome', _l.full_name,
    'whatsapp', _l.whatsapp,
    'whatsapp_norm', _l.whatsapp_norm,
    'email', _l.email,
    'cidade', _l.city,
    'uf', _l.uf,
    'etapa_id', _l.stage_id,
    'etapa_desde', _l.stage_entered_at,
    'prioridade', _l.priority,
    'desfecho', _l.outcome,
    'origem', _l.source_normalized,
    'campanha', _l.utm->>'utm_campaign',
    'criada_em', _l.created_at,
    'ultimo_envio', coalesce(
      (SELECT max(cs.created_at) FROM public.candidatura_submissions cs WHERE cs.lead_id = _l.id),
      _l.created_at
    ),
    'ultimo_contato', _l.last_contact_at,
    'primeiro_atendimento', _l.first_response_at,
    'proximo_followup', _l.next_followup_at,
    'arquivada_em', _l.archived_at,
    'reenvios', _l.submissions_count,
    'responsavel_id', _l.assigned_to,
    'responsavel', (SELECT p.full_name FROM public.profiles p WHERE p.id = _l.assigned_to),
    'representante_id', _l.representante_party_id,
    'representante', (SELECT p.display_name FROM public.parties p WHERE p.id = _l.representante_party_id),
    'representante_origem', _l.representante_origem,
    'maleta', public.crm_lead_maleta(_l),
    'tags', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.name, 'cor', t.color) ORDER BY t.name)
                        FROM public.candidatura_tag_links tl
                        JOIN public.candidatura_tags t ON t.id = tl.tag_id
                       WHERE tl.lead_id = _l.id), '[]'::jsonb)
  );
$function$;

CREATE TABLE IF NOT EXISTS public.asaas_cobranca_cancelamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL,
  external_id text NOT NULL,
  installment_id uuid,
  valor_cents bigint,
  vencimento date,
  motivo text NOT NULL,
  actor_id uuid NOT NULL,
  resultado text NOT NULL CHECK (resultado IN ('cancelada','ja_excluida','paga_no_asaas','falhou')),
  status_remoto text,
  erro text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.asaas_cobranca_cancelamentos TO authenticated;
GRANT ALL ON public.asaas_cobranca_cancelamentos TO service_role;
ALTER TABLE public.asaas_cobranca_cancelamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "financeiro le cancelamentos de cobranca" ON public.asaas_cobranca_cancelamentos
  FOR SELECT TO authenticated USING ((SELECT public.asaas_ator_pode(auth.uid(), 'finance.receivable.manage')));
CREATE INDEX IF NOT EXISTS asaas_cobranca_cancelamentos_charge ON public.asaas_cobranca_cancelamentos (charge_id);

CREATE OR REPLACE FUNCTION public.asaas_cobranca_cancelar_preparar(_charge uuid, _actor uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c record;
BEGIN
  IF _actor IS NULL OR NOT public.asaas_ator_pode(_actor, 'finance.receivable.manage') THEN
    RAISE EXCEPTION 'Sem acesso ao financeiro para cancelar cobrança.' USING errcode = '42501';
  END IF;
  SELECT * INTO c FROM public.asaas_charges WHERE id = _charge;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Cobrança não encontrada.'; END IF;
  IF c.external_status NOT IN ('PENDING','OVERDUE') THEN
    RAISE EXCEPTION 'Só dá para cancelar cobrança aguardando pagamento ou vencida (esta está %).', coalesce(c.external_status, 'sem situação');
  END IF;
  IF EXISTS (SELECT 1 FROM public.asaas_charge_intents x WHERE x.acordo_simulacao_id IS NOT NULL
              AND (x.charge_id = c.id OR (x.account_id = c.account_id AND x.external_id = c.external_id))) THEN
    RAISE EXCEPTION 'Cobrança de acordo: cancele pelo acordo na Central de Cobranças.';
  END IF;
  RETURN jsonb_build_object('external_id', c.external_id, 'valor_cents', c.value_cents, 'vencimento', c.due_date, 'installment_id', c.installment_id);
END $function$;
REVOKE ALL ON FUNCTION public.asaas_cobranca_cancelar_preparar(uuid,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_cobranca_cancelar_preparar(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.asaas_cobranca_cancelar_registrar(_charge uuid, _actor uuid, _motivo text, _resultado text, _status_remoto text, _erro text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c record; v_it record; v_id uuid;
BEGIN
  IF _resultado NOT IN ('cancelada','ja_excluida','paga_no_asaas','falhou') THEN RAISE EXCEPTION 'Resultado inválido.'; END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo (mínimo 5 letras).'; END IF;
  SELECT * INTO c FROM public.asaas_charges WHERE id = _charge FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Cobrança não encontrada.'; END IF;
  INSERT INTO public.asaas_cobranca_cancelamentos (charge_id, external_id, installment_id, valor_cents, vencimento, motivo, actor_id, resultado, status_remoto, erro)
  VALUES (c.id, c.external_id, c.installment_id, c.value_cents, c.due_date, btrim(_motivo), _actor, _resultado, _status_remoto, left(_erro, 400))
  RETURNING id INTO v_id;
  IF _resultado IN ('cancelada','ja_excluida') THEN
    PERFORM set_config('lardann.asaas_link','on', true);
    PERFORM set_config('lardann.asaas_saldo','on', true);
    UPDATE public.asaas_charges SET external_status = 'DELETED',
           reconcile_note = left('Cancelada no Lardan pela ficha do título: ' || btrim(_motivo), 300)
     WHERE id = c.id AND external_status IN ('PENDING','OVERDUE');
    PERFORM set_config('lardann.asaas_intent','on', true);
    FOR v_it IN SELECT id, state FROM public.asaas_charge_intents WHERE charge_id = c.id AND state IN ('criada','conciliacao') FOR UPDATE LOOP
      UPDATE public.asaas_charge_intents SET state = 'cancelada', resolved_at = now(),
             last_error = 'Cobrança cancelada no Asaas pela ficha do título: ' || left(btrim(_motivo), 200) WHERE id = v_it.id;
      INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
      VALUES (v_it.id, v_it.state, 'cancelada', jsonb_build_object('motivo', 'cancelamento_manual', 'registro', v_id), _actor);
    END LOOP;
    PERFORM set_config('lardann.asaas_intent','off', true);
    PERFORM set_config('lardann.asaas_saldo','off', true);
    PERFORM set_config('lardann.asaas_link','off', true);
  END IF;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_actor, 'asaas.cobranca.cancelar_manual', 'asaas_charges', c.id::text,
    jsonb_build_object('external_id', c.external_id, 'valor_cents', c.value_cents, 'vencimento', c.due_date, 'motivo', btrim(_motivo),
                       'resultado', _resultado, 'status_remoto', _status_remoto, 'erro', left(_erro, 300)));
  RETURN jsonb_build_object('id', v_id, 'resultado', _resultado);
END $function$;
REVOKE ALL ON FUNCTION public.asaas_cobranca_cancelar_registrar(uuid,uuid,text,text,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_cobranca_cancelar_registrar(uuid,uuid,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.consultora_cockpit_financeiro(_party uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date; r jsonb;
BEGIN
  IF NOT (public.cob_pode(auth.uid()) OR public.has_capability(auth.uid(), 'registry.finance.view')) THEN
    RAISE EXCEPTION 'Sem permissão para ver o financeiro desta pessoa';
  END IF;
  with ab as (select * from public.cob_parcelas_abertas() p where p.party_id=_party and p.saldo_cents>0)
  select jsonb_build_object(
    'resumo', jsonb_build_object(
      'vencido_cents', (select coalesce(sum(saldo_cents),0) from ab where vencimento<hoje),
      'a_vencer_cents', (select coalesce(sum(saldo_cents),0) from ab where vencimento>=hoje),
      'parcelas_abertas', (select count(*) from ab),
      'maior_atraso', (select coalesce(max(hoje-vencimento),0) from ab where vencimento<hoje),
      'recebido_cents', (select coalesce(sum(case when s.is_reversal then -a.valor_cents else a.valor_cents end),0)
         from financial_allocations a join financial_settlements s on s.id=a.settlement_id join financial_installments i on i.id=a.installment_id join financial_titles t on t.id=i.title_id
         where coalesce(t.pagador_party_id,t.party_id)=_party and t.direction='receivable'),
      'comissao_cents', (select coalesce(sum(comissao_cents),0) from referral_commissions where sponsor_party_id=_party),
      'praca', (select jsonb_build_object('codigo',pc.codigo,'nome',pc.nome) from consultant_profiles cp join cob_pracas pc on pc.id=cp.praca_id where cp.party_id=_party),
      'representante', (select rp.display_name from consultant_profiles cp join parties rp on rp.id=cp.representative_party_id where cp.party_id=_party),
      'codigo_legado', (select codigo from party_codigos_legados where party_id=_party and sistema='cliente' limit 1),
      'etapa_cobranca', (select etapa from cob_casos where party_id=_party)
    ),
    'parcelas', coalesce((select jsonb_agg(jsonb_build_object('installment_id',ab.installment_id,'title_id',ab.title_id,'numero',ab.numero,'vencimento',ab.vencimento,'saldo_cents',ab.saldo_cents,'valor_cents',ab.valor_cents,'atraso',greatest(hoje-ab.vencimento,0),
        'origem',t.sistema_origem,'descricao',t.descricao) order by ab.vencimento) from ab join financial_titles t on t.id=ab.title_id),'[]'),
    'fiado', coalesce((select jsonb_agg(jsonb_build_object('linha',f.linha,'lote',f.lote,'data_cobranca',f.data_cobranca,'vencimento',f.vencimento,'parcela',f.parcela,'valor_cents',f.valor_cents,
        'situacao_titulo',(select i.settlement_status from financial_installments i where i.title_id=coalesce(f.title_id,fv.title_id) limit 1),'title_id',coalesce(f.title_id,fv.title_id),
        'titulo',(select t2.numero from financial_titles t2 where t2.id=coalesce(f.title_id,fv.title_id)),'importado_em',f.created_at) order by f.vencimento) from cob_fiado_linhas f left join legado_fiado_vinculo fv on fv.linha_id=f.id and fv.como='pendente_resolvida' where f.party_id = any(public.party_e_unificadas(_party)) or fv.party_id=_party),'[]'),
    'recebimentos', coalesce((select jsonb_agg(jsonb_build_object('data',s.data,'valor_cents',a.valor_cents,'estorno',s.is_reversal,'referencia',s.referencia,'titulo',t.numero,'title_id',t.id,'settlement_id',s.id) order by s.data desc)
        from financial_allocations a join financial_settlements s on s.id=a.settlement_id join financial_installments i on i.id=a.installment_id join financial_titles t on t.id=i.title_id
        where coalesce(t.pagador_party_id,t.party_id)=_party and t.direction='receivable'),'[]'),
    'comissoes', coalesce((select jsonb_agg(jsonb_build_object('id',rc.id,'data',rc.created_at,'indicada',ip.display_name,'indicada_id',ip.id,'venda_cents',rc.venda_cents,'percentual',rc.percentual,'comissao_cents',rc.comissao_cents,'status',rc.status) order by rc.created_at desc)
        from referral_commissions rc left join parties ip on ip.id=rc.indicada_party_id where rc.sponsor_party_id=_party),'[]'),
    'maletas', coalesce((select jsonb_agg(jsonb_build_object('id',kc.id,'ciclo',kc.cycle_no,'codigo',(select k.code from kits k where k.id=kc.kit_id),'status',kc.status,'valor_cents',kc.reference_total_cents,'pecas',kc.quantity_total,'recebida',kc.received_at,'fechada',kc.closed_at) order by kc.created_at desc)
        from kit_cycles kc where kc.consultora_party_id=_party),'[]'),
    'promessas', coalesce((select jsonb_agg(jsonb_build_object('valor_cents',x.valor_cents,'data',x.data_prometida,'status',x.status) order by x.created_at desc) from cob_promessas x where x.party_id=_party),'[]')
  ) into r;
  RETURN r;
END $function$;