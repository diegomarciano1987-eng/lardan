-- Etapa D: sugestão 7.1.7 para recebimento judicial (nunca baixa sozinha) e classificação 3.1.1 padrão das faturas de venda.
CREATE OR REPLACE FUNCTION public.fin_judicial_por_historico(_h text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_txt text := coalesce(_h,''); v_palavra boolean; v_nums text[]; v_party uuid; v_proc text; v_n int;
BEGIN
  v_palavra := v_txt ~* '(alvar|judic|judicail|dep\.? ?jud|tribunal|justi[cç]a|sisbajud|bacenjud|recurso jud)';
  SELECT array_agg(right(m[1], 20)) INTO v_nums FROM regexp_matches(v_txt, '([0-9]{20,})', 'g') m;
  IF NOT v_palavra AND v_nums IS NULL THEN RETURN NULL; END IF;
  IF v_nums IS NOT NULL THEN
    WITH c AS (
      SELECT party_id, numero_processo proc FROM cob_judicial_processos
       WHERE party_id IS NOT NULL AND regexp_replace(coalesce(numero_processo,''),'\D','','g') = ANY (v_nums)
      UNION
      SELECT party_id, processo FROM cob_judicial
       WHERE regexp_replace(coalesce(processo,''),'\D','','g') = ANY (v_nums)
    )
    SELECT count(DISTINCT party_id), min(party_id::text)::uuid, min(proc) INTO v_n, v_party, v_proc FROM c;
    IF v_n <> 1 THEN v_party := NULL; v_proc := NULL; END IF;
  END IF;
  IF NOT v_palavra AND v_party IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('party_id', v_party, 'processo', v_proc,
    'motivo', CASE WHEN v_party IS NOT NULL THEN 'numero_processo' ELSE 'palavra_judicial' END);
END $$;
REVOKE ALL ON FUNCTION public.fin_judicial_por_historico(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fin_judicial_por_historico(text) TO service_role;

CREATE OR REPLACE FUNCTION public.fin_mesa_palpite(_line uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_chave text; v_kind text; v_acc uuid; v_hist text; v_res jsonb; v_jud jsonb; v_717 uuid; v_nome text;
begin
  if not has_capability(auth.uid(),'finance.statement.view') then raise exception 'Sem permissão'; end if;
  select fin_historico_chave(historico), kind, financial_account_id, historico into v_chave, v_kind, v_acc, v_hist
    from financial_statement_lines where id = _line;
  if v_chave is null then
    v_res := jsonb_build_object('chave', null, 'vezes', 0);
  else
    with base as (
      select t.party_id, t.cost_center_id, t.chart_account_id, t.payment_method_id
        from financial_statement_lines l
        join financial_reconciliation_allocations a on a.line_id = l.id
        join financial_reconciliations r on r.id = a.reconciliation_id and r.status = 'ativa'
        join financial_installments i on i.id = a.installment_id
        join financial_titles t on t.id = i.title_id
       where l.kind = v_kind and l.id <> _line and fin_historico_chave(l.historico) = v_chave
    ), moda as (
      select
        (select party_id from base where party_id is not null group by 1 order by count(*) desc limit 1) party_id,
        (select cost_center_id from base where cost_center_id is not null group by 1 order by count(*) desc limit 1) cost_center_id,
        (select chart_account_id from base where chart_account_id is not null group by 1 order by count(*) desc limit 1) chart_account_id,
        (select payment_method_id from base where payment_method_id is not null group by 1 order by count(*) desc limit 1) payment_method_id,
        (select count(*) from base) vezes
    )
    select jsonb_build_object('chave', v_chave, 'vezes', m.vezes,
        'party_id', m.party_id, 'party_nome', coalesce(p.display_name, p.legal_name),
        'cost_center_id', m.cost_center_id, 'chart_account_id', m.chart_account_id,
        'payment_method_id', m.payment_method_id)
      into v_res from moda m left join parties p on p.id = m.party_id;
  end if;
  -- Recebimento judicial: sugere 7.1.7 (+ devedora pelo número do processo). Só sugestão: um humano confirma.
  if v_kind = 'entrada' then
    v_jud := fin_judicial_por_historico(v_hist);
    if v_jud is not null then
      select id into v_717 from chart_of_accounts where codigo = '7.1.7' limit 1;
      select coalesce(display_name, legal_name) into v_nome from parties where id = (v_jud->>'party_id')::uuid;
      v_res := v_res || jsonb_build_object('judicial', jsonb_build_object(
        'chart_account_id', v_717, 'party_id', v_jud->'party_id', 'party_nome', v_nome,
        'processo', v_jud->'processo', 'motivo', v_jud->'motivo'));
    end if;
  end if;
  return v_res;
end $$;
REVOKE ALL ON FUNCTION public.fin_mesa_palpite(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fin_mesa_palpite(uuid) TO authenticated;

-- Faturas de venda (consultora, PDV, representante) nascem na 3.1.1 quando ninguém classificou.
CREATE OR REPLACE FUNCTION public.fin_titulo_revenda_padrao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.chart_account_id IS NULL AND NEW.direction::text = 'receivable'
     AND NEW.origem IN ('consultora','pdv','representante') THEN
    SELECT id INTO NEW.chart_account_id FROM chart_of_accounts WHERE codigo = '3.1.1' LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fin_titulo_revenda_padrao() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS fin_titulo_revenda_padrao ON public.financial_titles;
CREATE TRIGGER fin_titulo_revenda_padrao BEFORE INSERT ON public.financial_titles
  FOR EACH ROW EXECUTE FUNCTION public.fin_titulo_revenda_padrao();