-- 0359 (Diego, 20/11/2026) — Unificação de praças e transferência de carteira entre representantes.
-- (0358 foi registrada vazia por engano; esta é a mudança real.)
-- Caso de origem: praça TELEMACO BORBA (40) unificada em PONTA GROSSA (64); carteira e remessa 934 de Daniel para Marcelo.
-- Regras: prévia primeiro; aplicação atômica e registrada linha a linha; desfazer pelo lote (só o que não mudou depois);
-- notas fiscais, títulos, fiado (cob_fiado_linhas imutável) e histórico SmallData (legado_*) nunca são tocados.

CREATE TABLE public.praca_unificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote uuid NOT NULL,
  origem_praca_id uuid NOT NULL REFERENCES public.cob_pracas(id),
  destino_praca_id uuid NOT NULL REFERENCES public.cob_pracas(id),
  motivo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  desfeita_em timestamptz,
  CONSTRAINT praca_unificacoes_diferentes CHECK (origem_praca_id <> destino_praca_id)
);
CREATE UNIQUE INDEX praca_unificacoes_origem_ativa ON public.praca_unificacoes (origem_praca_id) WHERE desfeita_em IS NULL;
GRANT SELECT ON public.praca_unificacoes TO authenticated;
GRANT ALL ON public.praca_unificacoes TO service_role;
ALTER TABLE public.praca_unificacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe de maletas vê unificações de praça" ON public.praca_unificacoes
  FOR SELECT TO authenticated USING ((SELECT public.can_manage_kits(auth.uid())));

CREATE TABLE public.praca_transferencia_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote uuid NOT NULL,
  tabela text NOT NULL,
  registro_id uuid NOT NULL,
  coluna text NOT NULL,
  antes text,
  depois text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz
);
CREATE INDEX praca_transferencia_log_lote ON public.praca_transferencia_log (lote, tabela, coluna);
GRANT ALL ON public.praca_transferencia_log TO service_role;
ALTER TABLE public.praca_transferencia_log ENABLE ROW LEVEL SECURITY;

-- Praça que vale hoje: uma praça unificada aponta para a praça que a absorveu.
CREATE OR REPLACE FUNCTION public.praca_efetiva(_id uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT coalesce((SELECT u.destino_praca_id FROM public.praca_unificacoes u
                    WHERE u.origem_praca_id = _id AND u.desfeita_em IS NULL), _id)
$$;
REVOKE ALL ON FUNCTION public.praca_efetiva(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.praca_efetiva(uuid) TO authenticated, service_role;

-- Nenhum caminho (vínculo SmallData, endereço, edição manual, nova remessa) volta a gravar a praça unificada.
CREATE OR REPLACE FUNCTION public.praca_unificada_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.praca_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.praca_id IS DISTINCT FROM OLD.praca_id) THEN
    NEW.praca_id := public.praca_efetiva(NEW.praca_id);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.praca_unificada_trg() FROM PUBLIC, anon, authenticated;

-- nomes escolhidos para rodar depois de a_consultora_praca_na_ficha e antes de aa_consultora_rep_da_praca
CREATE TRIGGER a_consultora_praca_unificada BEFORE INSERT OR UPDATE OF praca_id ON public.consultant_profiles
  FOR EACH ROW EXECUTE FUNCTION public.praca_unificada_trg();
CREATE TRIGGER a_remessa_praca_unificada BEFORE INSERT OR UPDATE OF praca_id ON public.remessas
  FOR EACH ROW EXECUTE FUNCTION public.praca_unificada_trg();

-- Cidades da praça unificada passam a cair na praça que a absorveu.
CREATE OR REPLACE FUNCTION public.praca_pela_cidade(_cidade text, _uf text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN count(DISTINCT d.id) = 1 THEN min(d.id::text)::uuid END
  FROM cob_pracas p
  JOIN legado_pracas lp ON lp.praca_id = p.id
  JOIN cob_pracas d ON d.id = public.praca_efetiva(p.id)
  WHERE d.ativo AND (p.ativo OR d.id <> p.id)
    AND p.nome NOT ILIKE '%INTERNO%' AND d.nome NOT ILIKE '%INTERNO%'
    AND public.cidade_norm(_cidade) <> '' AND btrim(coalesce(_uf,'')) <> ''
    AND (public.cidade_norm(_cidade) || '/' || upper(btrim(_uf))) = ANY (
      SELECT public.cidade_norm(x) FROM unnest(string_to_array(lp.cidades, '|')) x)
$function$;

-- Sugestão de praça pelo cadastro SmallData segue a unificação.
CREATE OR REPLACE FUNCTION public.rep_pracas_vinculo(_rep uuid, _consultora uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_codes int[]; v_res jsonb; v_sug uuid; v_nome text;
begin
  if not (has_capability(auth.uid(),'registry.view') or cob_pode(auth.uid())) then
    raise exception 'Sem permissão';
  end if;
  select upper(trim(display_name)) into v_nome from parties where id = _rep;
  -- Histórico SmallData do representante: pelo vínculo ou, se o vínculo apontar outro cadastro, pelo mesmo nome (só leitura, sugestão).
  select array_agg(distinct x) into v_codes from (
    select unnest(pracas) x from legado_representantes where party_id = _rep or upper(trim(nome)) = v_nome
    union select c.codigo from remessas r join cob_pracas c on c.id = r.praca_id where r.representante_party_id = _rep
  ) s;
  with p as (
    select distinct c.id, c.codigo, c.nome from cob_pracas c
    left join legado_pracas l on l.praca_id = c.id
    where c.ativo and (c.codigo = any(coalesce(v_codes,'{}')) or l.codigo = any(coalesce(v_codes,'{}')))
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'codigo',codigo,'nome',nome) order by codigo),'[]') into v_res from p;
  if _consultora is not null then
    select public.praca_efetiva(c.id) into v_sug from legado_consultoras lc join cob_pracas c on c.codigo::text = trim(lc.praca::text)
    where lc.party_id = _consultora and c.codigo = any(coalesce(v_codes,'{}')) limit 1;
  end if;
  return jsonb_build_object('pracas', v_res, 'sugestao', v_sug);
end $function$;

-- Prévia (padrão) e aplicação da unificação + transferência. Só o executor interno chama (sem GRANT para usuários).
CREATE OR REPLACE FUNCTION public.pracas_unificar_transferir(
  _origem_codigo integer, _destino_codigo integer, _rep_de uuid, _rep_para uuid,
  _remessas integer[], _motivo text, _aplicar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  o cob_pracas; d cob_pracas; v_lote uuid := gen_random_uuid(); rm record; v_num int;
  v_rems jsonb; v_excl uuid[]; v_resumo jsonb; v_avisos jsonb := '[]'::jsonb;
  n_praca int; n_rep int; n_rem_praca int; n_rem_rep int; n_kit int; n_fora int; n_excl int;
BEGIN
  IF coalesce(btrim(_motivo), '') = '' THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  IF _rep_de IS NULL OR _rep_para IS NULL OR _rep_de = _rep_para THEN RAISE EXCEPTION 'Informe representantes de origem e destino diferentes.'; END IF;
  SELECT * INTO o FROM cob_pracas WHERE codigo = _origem_codigo FOR UPDATE;
  SELECT * INTO d FROM cob_pracas WHERE codigo = _destino_codigo FOR UPDATE;
  IF o.id IS NULL OR d.id IS NULL THEN RAISE EXCEPTION 'Praça não encontrada.'; END IF;
  IF o.id = d.id THEN RAISE EXCEPTION 'Praças de origem e destino iguais.'; END IF;
  IF NOT d.ativo THEN RAISE EXCEPTION 'A praça de destino % está desativada.', d.nome; END IF;
  IF EXISTS (SELECT 1 FROM praca_unificacoes u WHERE u.desfeita_em IS NULL AND u.origem_praca_id IN (o.id, d.id)) THEN
    RAISE EXCEPTION 'Uma das praças já foi unificada.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM parties p JOIN party_roles pr ON pr.party_id = p.id AND pr.role = 'representante'
                  WHERE p.id = _rep_para AND p.status = 'ativo') THEN
    RAISE EXCEPTION 'O representante de destino não é um representante ativo.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM party_roles pr WHERE pr.party_id = _rep_de AND pr.role = 'representante') THEN
    RAISE EXCEPTION 'O representante de origem não tem cadastro de representante.';
  END IF;
  FOREACH v_num IN ARRAY coalesce(_remessas, '{}') LOOP
    SELECT * INTO rm FROM remessas WHERE numero = v_num FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Remessa % não encontrada.', v_num; END IF;
    IF rm.praca_id NOT IN (o.id, d.id) THEN RAISE EXCEPTION 'Remessa % não é das praças informadas.', v_num; END IF;
    IF rm.representante_party_id IS DISTINCT FROM _rep_de AND rm.representante_party_id IS DISTINCT FROM _rep_para THEN
      RAISE EXCEPTION 'Remessa % é de outro representante.', v_num;
    END IF;
    IF rm.status IN ('fechada', 'cancelada') THEN RAISE EXCEPTION 'Remessa % está %.', v_num, rm.status; END IF;
  END LOOP;

  -- colaboradoras e representantes nunca mudam de carteira por aqui
  SELECT coalesce(array_agg(x), '{}') INTO v_excl FROM (
    SELECT party_id x FROM colab_acessos UNION SELECT party_id FROM party_roles WHERE role = 'representante') s;

  SELECT count(*) INTO n_praca FROM consultant_profiles WHERE praca_id = o.id;
  SELECT count(*) INTO n_rep FROM consultant_profiles
   WHERE praca_id IN (o.id, d.id) AND representative_party_id = _rep_de AND NOT party_id = ANY (v_excl);
  SELECT count(*) INTO n_excl FROM consultant_profiles
   WHERE praca_id IN (o.id, d.id) AND representative_party_id = _rep_de AND party_id = ANY (v_excl);
  SELECT count(*) INTO n_rem_praca FROM remessas WHERE numero = ANY (_remessas) AND praca_id = o.id;
  SELECT count(*) INTO n_rem_rep FROM remessas WHERE numero = ANY (_remessas) AND representante_party_id = _rep_de;
  SELECT count(*) INTO n_kit FROM kit_cycles k JOIN remessas r ON r.id = k.remessa_id
   WHERE r.numero = ANY (_remessas) AND k.representante_party_id = _rep_de AND k.status <> 'cancelada';
  SELECT count(*) INTO n_fora FROM kit_cycles k JOIN consultant_profiles c ON c.party_id = k.consultora_party_id
   LEFT JOIN remessas r ON r.id = k.remessa_id
   WHERE c.praca_id IN (o.id, d.id) AND k.representante_party_id = _rep_de
     AND k.status NOT IN ('encerrada', 'cancelada') AND (r.numero IS NULL OR NOT r.numero = ANY (_remessas));
  IF n_fora > 0 THEN
    v_avisos := v_avisos || to_jsonb(format('%s maleta(s) aberta(s) dessas consultoras fora das remessas informadas continuam com o representante de origem.', n_fora));
  END IF;
  IF n_excl > 0 THEN
    v_avisos := v_avisos || to_jsonb(format('%s cadastro(s) de colaboradora/representante na praça ficam como estão.', n_excl));
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('numero', r.numero, 'status', r.status,
           'praca_antes', pa.nome, 'praca_depois', CASE WHEN r.praca_id = o.id THEN d.nome ELSE pa.nome END,
           'rep_antes', ra.display_name, 'rep_depois', CASE WHEN r.representante_party_id = _rep_de THEN rp.display_name ELSE ra.display_name END,
           'maletas', (SELECT count(*) FROM kit_cycles k WHERE k.remessa_id = r.id AND k.status <> 'cancelada')) ORDER BY r.numero), '[]')
    INTO v_rems
    FROM remessas r JOIN cob_pracas pa ON pa.id = r.praca_id LEFT JOIN parties ra ON ra.id = r.representante_party_id
    LEFT JOIN parties rp ON rp.id = _rep_para
   WHERE r.numero = ANY (_remessas);

  v_resumo := jsonb_build_object(
    'praca_origem', o.nome, 'praca_destino', d.nome,
    'rep_de', (SELECT display_name FROM parties WHERE id = _rep_de), 'rep_para', (SELECT display_name FROM parties WHERE id = _rep_para),
    'consultoras_mudam_praca', n_praca, 'consultoras_mudam_representante', n_rep,
    'remessas_mudam_praca', n_rem_praca, 'remessas_mudam_representante', n_rem_rep,
    'maletas_mudam_representante', n_kit, 'remessas', v_rems, 'avisos', v_avisos,
    'nao_mexe', jsonb_build_array('notas fiscais', 'títulos e cobranças', 'fiado (linhas imutáveis)', 'histórico SmallData', 'maletas canceladas'));

  IF NOT coalesce(_aplicar, false) THEN
    RETURN v_resumo || jsonb_build_object('previa', true);
  END IF;

  INSERT INTO praca_unificacoes (lote, origem_praca_id, destino_praca_id, motivo) VALUES (v_lote, o.id, d.id, _motivo);

  -- 1) consultoras da praça unificada
  INSERT INTO praca_transferencia_log (lote, tabela, registro_id, coluna, antes, depois)
  SELECT v_lote, 'consultant_profiles', party_id, 'praca_id', o.id::text, d.id::text FROM consultant_profiles WHERE praca_id = o.id;
  UPDATE consultant_profiles c SET praca_id = d.id
   WHERE c.party_id IN (SELECT registro_id FROM praca_transferencia_log WHERE lote = v_lote AND tabela = 'consultant_profiles' AND coluna = 'praca_id');

  -- 2) carteira do representante de origem nas duas praças
  INSERT INTO praca_transferencia_log (lote, tabela, registro_id, coluna, antes, depois)
  SELECT v_lote, 'consultant_profiles', party_id, 'representative_party_id', _rep_de::text, _rep_para::text FROM consultant_profiles
   WHERE praca_id = d.id AND representative_party_id = _rep_de AND NOT party_id = ANY (v_excl);
  UPDATE consultant_profiles c SET representative_party_id = _rep_para
   WHERE c.party_id IN (SELECT registro_id FROM praca_transferencia_log WHERE lote = v_lote AND tabela = 'consultant_profiles' AND coluna = 'representative_party_id');

  -- 3) remessas
  INSERT INTO praca_transferencia_log (lote, tabela, registro_id, coluna, antes, depois)
  SELECT v_lote, 'remessas', id, 'praca_id', o.id::text, d.id::text FROM remessas WHERE numero = ANY (_remessas) AND praca_id = o.id;
  INSERT INTO praca_transferencia_log (lote, tabela, registro_id, coluna, antes, depois)
  SELECT v_lote, 'remessas', id, 'representante_party_id', _rep_de::text, _rep_para::text FROM remessas WHERE numero = ANY (_remessas) AND representante_party_id = _rep_de;
  UPDATE remessas r SET praca_id = d.id, updated_at = now()
   WHERE r.id IN (SELECT registro_id FROM praca_transferencia_log WHERE lote = v_lote AND tabela = 'remessas' AND coluna = 'praca_id');
  UPDATE remessas r SET representante_party_id = _rep_para, updated_at = now()
   WHERE r.id IN (SELECT registro_id FROM praca_transferencia_log WHERE lote = v_lote AND tabela = 'remessas' AND coluna = 'representante_party_id');

  -- 4) maletas dessas remessas (status, consultora, peças e notas não mudam)
  INSERT INTO praca_transferencia_log (lote, tabela, registro_id, coluna, antes, depois)
  SELECT v_lote, 'kit_cycles', k.id, 'representante_party_id', _rep_de::text, _rep_para::text
    FROM kit_cycles k JOIN remessas r ON r.id = k.remessa_id
   WHERE r.numero = ANY (_remessas) AND k.representante_party_id = _rep_de AND k.status <> 'cancelada';
  UPDATE kit_cycles k SET representante_party_id = _rep_para
   WHERE k.id IN (SELECT registro_id FROM praca_transferencia_log WHERE lote = v_lote AND tabela = 'kit_cycles' AND coluna = 'representante_party_id');

  -- 5) praça unificada desativada (nenhuma remessa ou cadastro novo nela)
  INSERT INTO praca_transferencia_log (lote, tabela, registro_id, coluna, antes, depois)
  VALUES (v_lote, 'cob_pracas', o.id, 'ativo', o.ativo::text, 'false');
  UPDATE cob_pracas SET ativo = false WHERE id = o.id;

  v_resumo := v_resumo || jsonb_build_object('previa', false, 'lote', v_lote);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'praca.unificar_transferir', 'cob_pracas', o.id::text, v_resumo || jsonb_build_object('motivo', _motivo));
  RETURN v_resumo;
END $$;
REVOKE ALL ON FUNCTION public.pracas_unificar_transferir(integer, integer, uuid, uuid, integer[], text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pracas_unificar_transferir(integer, integer, uuid, uuid, integer[], text, boolean) TO service_role;

-- Desfazer pelo lote: devolve só o que continua como a transferência deixou; o que mudou depois fica e é contado.
CREATE OR REPLACE FUNCTION public.pracas_unificar_desfazer(_lote uuid, _motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int; v jsonb := '{}'::jsonb; t int := 0; total int;
BEGIN
  IF coalesce(btrim(_motivo), '') = '' THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  UPDATE praca_unificacoes SET desfeita_em = now() WHERE lote = _lote AND desfeita_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado ou já desfeito.'; END IF;

  UPDATE kit_cycles k SET representante_party_id = l.antes::uuid FROM praca_transferencia_log l
   WHERE l.lote = _lote AND l.tabela = 'kit_cycles' AND l.coluna = 'representante_party_id' AND l.desfeito_em IS NULL
     AND k.id = l.registro_id AND k.representante_party_id::text IS NOT DISTINCT FROM l.depois;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('maletas', n); t := t + n;
  UPDATE remessas r SET representante_party_id = l.antes::uuid, updated_at = now() FROM praca_transferencia_log l
   WHERE l.lote = _lote AND l.tabela = 'remessas' AND l.coluna = 'representante_party_id' AND l.desfeito_em IS NULL
     AND r.id = l.registro_id AND r.representante_party_id::text IS NOT DISTINCT FROM l.depois;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('remessas_representante', n); t := t + n;
  UPDATE remessas r SET praca_id = l.antes::uuid, updated_at = now() FROM praca_transferencia_log l
   WHERE l.lote = _lote AND l.tabela = 'remessas' AND l.coluna = 'praca_id' AND l.desfeito_em IS NULL
     AND r.id = l.registro_id AND r.praca_id::text IS NOT DISTINCT FROM l.depois;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('remessas_praca', n); t := t + n;
  UPDATE consultant_profiles c SET representative_party_id = l.antes::uuid FROM praca_transferencia_log l
   WHERE l.lote = _lote AND l.tabela = 'consultant_profiles' AND l.coluna = 'representative_party_id' AND l.desfeito_em IS NULL
     AND c.party_id = l.registro_id AND c.representative_party_id::text IS NOT DISTINCT FROM l.depois;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('consultoras_representante', n); t := t + n;
  UPDATE consultant_profiles c SET praca_id = l.antes::uuid FROM praca_transferencia_log l
   WHERE l.lote = _lote AND l.tabela = 'consultant_profiles' AND l.coluna = 'praca_id' AND l.desfeito_em IS NULL
     AND c.party_id = l.registro_id AND c.praca_id::text IS NOT DISTINCT FROM l.depois;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('consultoras_praca', n); t := t + n;
  UPDATE cob_pracas p SET ativo = l.antes::boolean FROM praca_transferencia_log l
   WHERE l.lote = _lote AND l.tabela = 'cob_pracas' AND l.coluna = 'ativo' AND l.desfeito_em IS NULL
     AND p.id = l.registro_id AND p.ativo::text = l.depois;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('praca_reativada', n); t := t + n;

  SELECT count(*) INTO total FROM praca_transferencia_log WHERE lote = _lote AND desfeito_em IS NULL;
  UPDATE praca_transferencia_log SET desfeito_em = now() WHERE lote = _lote AND desfeito_em IS NULL;
  v := v || jsonb_build_object('lote', _lote, 'devolvidos', t, 'mantidos_por_mudanca_posterior', total - t);
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'praca.unificar_desfazer', 'praca_unificacoes', _lote::text, v || jsonb_build_object('motivo', _motivo));
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.pracas_unificar_desfazer(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pracas_unificar_desfazer(uuid, text) TO service_role;