-- Alinha o retorno da função ao patch original sem editar a migração aplicada.
DO $restore$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.consultora_pagamento_titulo(uuid,text,text,date)'::regprocedure) INTO definition;
  IF position('RETURN jsonb_build_object(''installment_id'',inst,''actor'',cfg.ator_user_id,''forma'',o.pay_method,''vencimento'',venc);' in definition) = 0 THEN
    RAISE EXCEPTION 'Retorno esperado não encontrado; nenhuma alteração aplicada.';
  END IF;
  definition := replace(definition,
    'RETURN jsonb_build_object(''installment_id'',inst,''actor'',cfg.ator_user_id,''forma'',o.pay_method,''vencimento'',venc);',
    'RETURN jsonb_build_object(''installment_id'',inst,''actor'',cfg.ator_user_id,''forma'',_forma,''vencimento'',venc);');
  EXECUTE definition;
END $restore$;

-- Definição existente na base, registrada sem mudança de comportamento ou permissões.
CREATE OR REPLACE FUNCTION public.pdv_links_listar(_token_hash text, _dias integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s pdv_sessoes; d int := least(greatest(coalesce(_dias,30),1),365);
BEGIN
  s := public.pdv_sessao(_token_hash);
  RETURN coalesce((select jsonb_agg(x order by x->>'hora' desc) from (
    select jsonb_build_object(
      'id', v.id,
      'codigo', v.codigo,
      'hora', v.created_at,
      'status', v.status,
      'total', v.total_cents,
      'vendedora', public.pdv_nome_usuario(m.user_id),
      'cliente', v.cliente_nome,
      'telefone', v.cliente_telefone,
      'url', v.pix_url,
      'forma', case when c.billing_type = 'CREDIT_CARD' then 'cartao' else 'pix' end,
      'pago', case
        when v.status = 'concluida' then true
        when v.installment_id is not null and coalesce(public.fin_installment_saldo(v.installment_id),1) <= 0 then true
        else false end
    ) x
    from pdv_vendas v
    join pdv_membros m on m.id = v.membro_id
    left join asaas_charges c on c.id = v.pix_charge_id
    where v.unidade_id = s.unidade_id
      and v.pix_url is not null
      and (v.created_at at time zone 'America/Sao_Paulo')::date > (now() at time zone 'America/Sao_Paulo')::date - d
    order by v.created_at desc limit 300) z),'[]');
END $function$;