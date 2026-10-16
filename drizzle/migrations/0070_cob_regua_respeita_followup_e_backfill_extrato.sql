
CREATE OR REPLACE FUNCTION public.cob_regua_executar()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE hoje date := (now() at time zone 'America/Sao_Paulo')::date; criadas int:=0; canceladas int:=0; pm record; saldo bigint; n int;
BEGIN
  FOR pm IN select * from cob_promessas where status='vigente' and data_prometida < hoje LOOP
    select coalesce(sum(saldo_cents),0) into saldo from public.cob_parcelas_abertas() where installment_id = any(pm.installment_ids);
    UPDATE cob_promessas SET avaliada_em=now(), status = case when pm.saldo_inicial_cents - saldo >= pm.valor_cents or saldo=0 then 'cumprida'
       when pm.saldo_inicial_cents - saldo > 0 then 'parcial' else 'descumprida' end WHERE id=pm.id;
    UPDATE cob_casos SET pausa_ate=null, pausa_motivo=null WHERE party_id=pm.party_id;
  END LOOP;
  UPDATE cob_tarefas t SET status='cancelada', motivo_fim='Parcelas quitadas ou canceladas'
   WHERE t.status='aberta' and t.origem='regua'
     and not exists (select 1 from public.cob_parcelas_abertas() p where p.installment_id = any(t.installment_ids) and p.saldo_cents>0);
  GET DIAGNOSTICS canceladas = ROW_COUNT;
  INSERT INTO cob_tarefas(party_id,origem,regua_dias,chave,titulo,installment_ids,vence_em,responsavel_id)
  select p.party_id,'regua',e.dias,'regua:'||p.party_id||':'||e.dias||':'||min(p.vencimento),
         'D+'||e.dias||' · '||e.acao, array_agg(p.installment_id), hoje+e.prazo_dias, coalesce(c.responsavel_id,e.responsavel_id)
  from public.cob_parcelas_abertas() p
  join cob_regua_etapas e on e.ativo and hoje - p.vencimento >= e.dias
  left join cob_casos c on c.party_id=p.party_id
  where p.saldo_cents>0 and (c.pausa_ate is null or c.pausa_ate < hoje)
    and not exists (select 1 from cob_regua_etapas e2 where e2.ativo and e2.dias>e.dias and hoje-p.vencimento>=e2.dias)
    -- follow-up marcado por pessoa ainda em dia manda na próxima ação
    and not exists (select 1 from cob_tarefas h where h.party_id=p.party_id and h.status='aberta' and coalesce(h.origem,'')<>'regua' and h.vence_em>=hoje)
  group by p.party_id,e.dias,e.acao,e.prazo_dias,c.responsavel_id,e.responsavel_id
  ON CONFLICT (chave) DO NOTHING;
  GET DIAGNOSTICS criadas = ROW_COUNT;
  RETURN jsonb_build_object('criadas',criadas,'canceladas',canceladas,'data',hoje);
END $function$;

-- backfill: tarefas antigas da régua já substituídas por follow-up manual mais novo
WITH alvo AS (
  UPDATE cob_tarefas t SET status='concluida', concluida_em=now(), motivo_fim='Substituída por follow-up manual (correção retroativa)'
   WHERE t.status='aberta' AND t.origem='regua'
     AND EXISTS (SELECT 1 FROM cob_tarefas h WHERE h.party_id=t.party_id AND h.status='aberta' AND coalesce(h.origem,'')<>'regua' AND h.created_at>t.created_at)
  RETURNING t.id, t.party_id, t.vence_em, t.titulo)
INSERT INTO audit_logs(actor_id, action, entity, payload)
SELECT NULL,'cob.tarefas_substituidas_retroativo','cob_tarefas', jsonb_build_object('qtd',count(*),'tarefas',jsonb_agg(to_jsonb(alvo))) FROM alvo;

-- backfill: extrato Asaas pendente que já tem baixa oficial
DO $$ DECLARE p text; BEGIN
  FOR p IN SELECT DISTINCT raw->>'paymentId' FROM financial_statement_lines
            WHERE status IN ('pendente','parcial') AND raw->>'type' IN ('PAYMENT_RECEIVED','PAYMENT_FEE') AND raw->>'paymentId' IS NOT NULL LOOP
    PERFORM public.fin_asaas_extrato_autoconciliar(p);
  END LOOP;
END $$;
