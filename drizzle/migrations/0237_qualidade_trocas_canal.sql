-- Canal de Qualidade: trocas e garantias de maleta/pedido, mão dupla consultora <-> Lardan.
INSERT INTO public.role_capabilities(role,capability)
SELECT r::public.app_role, c FROM (VALUES ('master','quality.view'),('master','quality.manage'),('qualidade','quality.view'),('qualidade','quality.manage'),('diretoria','quality.view')) v(r,c)
WHERE NOT EXISTS(SELECT 1 FROM public.role_capabilities rc WHERE rc.role=v.r::public.app_role AND rc.capability=v.c);

CREATE OR REPLACE FUNCTION public.colab_caps_permitidas()
 RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
 SELECT ARRAY['catalog.view','catalog.manage','product.manage','catalog.publish','product.publish','catalog.cost.view','kit.view','kit.view.all','kit.manage','kit.ship','kit.receive','kit.acrescimo','kit.accept',
 'registry.view','registry.manage','partners.view','partners.manage',
 'imports.run','candidaturas.view','leads.view','candidaturas.edit','candidaturas.move','candidaturas.notes','candidaturas.followups','candidaturas.tags','candidaturas.assign',
 'site.manage','showcase.view','showcase.publish','network.aggregate.view',
 'collection.view','collection.operate','collection.negotiate','audit.view','quality.view','quality.manage']::text[] $function$;

CREATE TABLE public.qualidade_trocas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocolo bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  legado_id integer UNIQUE,
  origem text NOT NULL CHECK (origem IN ('legado_smalldata','admin_manual','app_consultora')),
  consultora_party_id uuid NOT NULL REFERENCES public.parties(id),
  consultora_codigo text,
  consultora_nome text,
  praca_codigo integer,
  praca_nome text,
  tipo text NOT NULL DEFAULT 'troca' CHECK (tipo IN ('troca','garantia')),
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_analise','aguardando_envio','resolvida','recusada')),
  motivo text,
  observacao text,
  dev_variant_id uuid REFERENCES public.product_variants(id),
  dev_produto_legado integer,
  dev_referencia text,
  dev_nome text,
  dev_tamanho text,
  dev_valor_cents integer,
  solucao text CHECK (solucao IN ('mesma_peca','troca','credito','conserto','sem_defeito')),
  rep_variant_id uuid REFERENCES public.product_variants(id),
  rep_produto_legado integer,
  rep_referencia text,
  rep_nome text,
  rep_tamanho text,
  rep_valor_cents integer,
  diferenca_cents integer,
  parecer text,
  fotos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fotos)='array' AND jsonb_array_length(fotos)<=6),
  aberto_em timestamptz NOT NULL DEFAULT now(),
  aberto_por uuid,
  aberto_por_nome text,
  finalizado_em timestamptz,
  finalizado_por uuid,
  finalizado_por_nome text,
  transmissao_em timestamptz,
  transmissao_por_nome text,
  importado_em timestamptz,
  importado_por_nome text,
  novidade_consultora boolean NOT NULL DEFAULT false,
  novidade_lardan boolean NOT NULL DEFAULT false,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qualidade_trocas_party_idx ON public.qualidade_trocas(consultora_party_id, aberto_em DESC);
CREATE INDEX qualidade_trocas_status_idx ON public.qualidade_trocas(status, aberto_em DESC);
CREATE INDEX qualidade_trocas_ref_idx ON public.qualidade_trocas(upper(dev_referencia));
GRANT SELECT ON public.qualidade_trocas TO authenticated;
GRANT ALL ON public.qualidade_trocas TO service_role;
ALTER TABLE public.qualidade_trocas ENABLE ROW LEVEL SECURITY;
CREATE POLICY qualidade_trocas_ler ON public.qualidade_trocas FOR SELECT TO authenticated USING (
  consultora_party_id = (SELECT public.my_party_id()) OR (SELECT public.has_capability(auth.uid(),'quality.view')));
CREATE TRIGGER qualidade_trocas_audit AFTER INSERT OR UPDATE ON public.qualidade_trocas FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

CREATE TABLE public.qualidade_trocas_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  troca_id uuid NOT NULL REFERENCES public.qualidade_trocas(id),
  autor text NOT NULL CHECK (autor IN ('consultora','lardan','sistema')),
  autor_nome text,
  status text,
  texto text,
  fotos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fotos)='array' AND jsonb_array_length(fotos)<=6),
  interno boolean NOT NULL DEFAULT false,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qualidade_trocas_eventos_troca_idx ON public.qualidade_trocas_eventos(troca_id, created_at);
GRANT SELECT ON public.qualidade_trocas_eventos TO authenticated;
GRANT ALL ON public.qualidade_trocas_eventos TO service_role;
ALTER TABLE public.qualidade_trocas_eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY qualidade_trocas_eventos_ler ON public.qualidade_trocas_eventos FOR SELECT TO authenticated USING (
  (SELECT public.has_capability(auth.uid(),'quality.view'))
  OR (NOT interno AND troca_id IN (SELECT t.id FROM public.qualidade_trocas t WHERE t.consultora_party_id = (SELECT public.my_party_id()))));

CREATE OR REPLACE FUNCTION public.qualidade_ator_nome() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce((SELECT pa.display_name FROM public.profiles pr JOIN public.parties pa ON pa.id=pr.party_id WHERE pr.id=auth.uid()),
                  (SELECT email FROM auth.users WHERE id=auth.uid()), 'Lardan') $$;
REVOKE ALL ON FUNCTION public.qualidade_ator_nome() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qualidade_ator_nome() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.qualidade_fotos_validas(_fotos jsonb) RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT jsonb_typeof(coalesce(_fotos,'[]'::jsonb))='array' AND jsonb_array_length(coalesce(_fotos,'[]'::jsonb))<=6
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(_fotos,'[]'::jsonb)) f WHERE jsonb_typeof(f)<>'string' OR (f #>> '{}') NOT LIKE auth.uid()::text||'/%') $$;

-- Peça do catálogo (nome, referência, tamanho, preço) a partir da variante.
CREATE OR REPLACE FUNCTION public.qualidade_peca(_variant uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('referencia',coalesce(nullif(v.reference_code,''),p.reference_code),'nome',p.name||CASE WHEN coalesce(v.label,'') NOT IN ('','Padrão') THEN ' · '||v.label ELSE '' END,
    'tamanho',v.size,'valor_cents',coalesce(v.price_cents,p.price_cents))
  FROM public.product_variants v JOIN public.products p ON p.id=v.product_id WHERE v.id=_variant $$;
REVOKE ALL ON FUNCTION public.qualidade_peca(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qualidade_peca(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.qualidade_troca_criar(_party uuid,_origem text,_variant uuid,_referencia text,_nome text,_tamanho text,_valor_cents integer,_tipo text,_motivo text,_observacao text,_fotos jsonb,_chave text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.qualidade_trocas; pa public.parties; peca jsonb; nome_ator text := public.qualidade_ator_nome(); praca record;
BEGIN
  IF length(coalesce(_chave,''))<8 THEN RAISE EXCEPTION 'Chave inválida.'; END IF;
  IF _tipo NOT IN ('troca','garantia') THEN RAISE EXCEPTION 'Escolha troca ou garantia.'; END IF;
  IF length(btrim(coalesce(_motivo,'')))<3 THEN RAISE EXCEPTION 'Informe o motivo (ex.: escureceu, pedra soltou).'; END IF;
  IF NOT public.qualidade_fotos_validas(_fotos) THEN RAISE EXCEPTION 'Fotos inválidas (até 6, da sua conta).'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_chave,0));
  SELECT * INTO r FROM public.qualidade_trocas WHERE idempotency_key=_chave;
  IF r.id IS NOT NULL THEN
    IF r.aberto_por IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Chave usada em outra solicitação.'; END IF;
    RETURN jsonb_build_object('id',r.id,'protocolo','TG-'||lpad(r.protocolo::text,6,'0'),'repetida',true);
  END IF;
  SELECT * INTO pa FROM public.parties WHERE id=_party;
  IF pa.id IS NULL THEN RAISE EXCEPTION 'Consultora não encontrada.'; END IF;
  IF _variant IS NOT NULL THEN peca := public.qualidade_peca(_variant); IF peca IS NULL THEN RAISE EXCEPTION 'Peça não encontrada.'; END IF; END IF;
  IF _variant IS NULL AND length(btrim(coalesce(_referencia,'')))<3 AND length(btrim(coalesce(_nome,'')))<3 THEN RAISE EXCEPTION 'Escolha a peça ou digite a referência da etiqueta.'; END IF;
  SELECT lp.codigo, lp.nome INTO praca FROM public.qualidade_trocas t
    LEFT JOIN LATERAL (SELECT t.praca_codigo AS codigo, t.praca_nome AS nome) lp ON true
    WHERE t.consultora_party_id=_party AND t.praca_nome IS NOT NULL ORDER BY t.aberto_em DESC LIMIT 1;
  INSERT INTO public.qualidade_trocas(origem,consultora_party_id,consultora_codigo,consultora_nome,praca_codigo,praca_nome,tipo,motivo,observacao,
     dev_variant_id,dev_referencia,dev_nome,dev_tamanho,dev_valor_cents,fotos,aberto_por,aberto_por_nome,idempotency_key,novidade_lardan,novidade_consultora)
  VALUES(_origem,_party,pa.code,coalesce(pa.display_name,pa.legal_name),praca.codigo,praca.nome,_tipo,btrim(_motivo),left(nullif(btrim(coalesce(_observacao,'')),''),1000),
     _variant,upper(coalesce(peca->>'referencia',nullif(btrim(_referencia),''))),coalesce(peca->>'nome',nullif(btrim(_nome),'')),coalesce(nullif(btrim(coalesce(_tamanho,'')),''),peca->>'tamanho'),
     coalesce((peca->>'valor_cents')::int,_valor_cents),coalesce(_fotos,'[]'::jsonb),auth.uid(),nome_ator,_chave,_origem='app_consultora',_origem='admin_manual')
  RETURNING * INTO r;
  INSERT INTO public.qualidade_trocas_eventos(troca_id,autor,autor_nome,status,texto,fotos,actor_id)
  VALUES(r.id,CASE WHEN _origem='app_consultora' THEN 'consultora' ELSE 'lardan' END,nome_ator,'aberta',r.motivo||coalesce(' · '||r.observacao,''),r.fotos,auth.uid());
  RETURN jsonb_build_object('id',r.id,'protocolo','TG-'||lpad(r.protocolo::text,6,'0'),'repetida',false);
END $$;
REVOKE ALL ON FUNCTION public.qualidade_troca_criar(uuid,text,uuid,text,text,text,integer,text,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualidade_troca_criar(uuid,text,uuid,text,text,text,integer,text,text,text,jsonb,text) TO service_role;

-- Consultora abre pelo app (peça da maleta, do catálogo ou referência digitada).
CREATE OR REPLACE FUNCTION public.qualidade_troca_abrir(_variant uuid,_referencia text,_tamanho text,_tipo text,_motivo text,_observacao text,_fotos jsonb,_chave text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE me uuid := public.my_party_id();
BEGIN
  IF auth.uid() IS NULL OR me IS NULL OR NOT public.has_role(auth.uid(),'consultora') THEN RAISE EXCEPTION 'Acesso não liberado.'; END IF;
  IF _tipo='garantia' AND jsonb_array_length(coalesce(_fotos,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'Envie ao menos uma foto da peça para garantia.'; END IF;
  RETURN public.qualidade_troca_criar(me,'app_consultora',_variant,_referencia,NULL,_tamanho,NULL,_tipo,_motivo,_observacao,_fotos,_chave);
END $$;
REVOKE ALL ON FUNCTION public.qualidade_troca_abrir(uuid,text,text,text,text,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qualidade_troca_abrir(uuid,text,text,text,text,text,jsonb,text) TO authenticated, service_role;

-- Lardan lança manualmente para uma consultora.
CREATE OR REPLACE FUNCTION public.qualidade_troca_lancar(_party uuid,_variant uuid,_referencia text,_nome text,_tamanho text,_valor_cents integer,_tipo text,_motivo text,_observacao text,_fotos jsonb,_chave text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_capability(auth.uid(),'quality.manage') THEN RAISE EXCEPTION 'Sem permissão para lançar trocas.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.party_roles WHERE party_id=_party AND role IN ('consultora','revendedora','candidata','cliente')) THEN RAISE EXCEPTION 'Escolha uma consultora.'; END IF;
  RETURN public.qualidade_troca_criar(_party,'admin_manual',_variant,_referencia,_nome,_tamanho,_valor_cents,_tipo,_motivo,_observacao,_fotos,_chave);
END $$;
REVOKE ALL ON FUNCTION public.qualidade_troca_lancar(uuid,uuid,text,text,text,integer,text,text,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qualidade_troca_lancar(uuid,uuid,text,text,text,integer,text,text,text,jsonb,text) TO authenticated, service_role;

-- Lardan muda a situação e dá a devolutiva (solução, peça de reposição, parecer).
CREATE OR REPLACE FUNCTION public.qualidade_troca_mover(_id uuid,_status text,_texto text,_dados jsonb DEFAULT '{}'::jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.qualidade_trocas; d jsonb := coalesce(_dados,'{}'::jsonb); peca jsonb; rv uuid; nome_ator text := public.qualidade_ator_nome();
  sol text; rref text; rnome text; rtam text; rval integer;
BEGIN
  IF NOT public.has_capability(auth.uid(),'quality.manage') THEN RAISE EXCEPTION 'Sem permissão para analisar.'; END IF;
  SELECT * INTO r FROM public.qualidade_trocas WHERE id=_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Solicitação inexistente.'; END IF;
  IF _status NOT IN ('aberta','em_analise','aguardando_envio','resolvida','recusada') THEN RAISE EXCEPTION 'Situação inválida.'; END IF;
  IF _status=r.status THEN RAISE EXCEPTION 'A solicitação já está nesta situação.'; END IF;
  IF r.status IN ('resolvida','recusada') AND _status NOT IN ('em_analise') THEN RAISE EXCEPTION 'Para alterar uma finalizada, reabra em análise.'; END IF;
  IF r.status IN ('resolvida','recusada') AND length(btrim(coalesce(_texto,'')))<5 THEN RAISE EXCEPTION 'Explique por que está reabrindo.'; END IF;
  IF _status='recusada' AND length(btrim(coalesce(_texto,'')))<5 THEN RAISE EXCEPTION 'Explique à consultora o motivo da recusa.'; END IF;
  sol := coalesce(nullif(d->>'solucao',''), r.solucao);
  IF sol IS NOT NULL AND sol NOT IN ('mesma_peca','troca','credito','conserto','sem_defeito') THEN RAISE EXCEPTION 'Solução inválida.'; END IF;
  IF _status IN ('aguardando_envio','resolvida') AND sol IS NULL THEN RAISE EXCEPTION 'Escolha a solução antes de finalizar.'; END IF;
  rv := nullif(d->>'rep_variant_id','')::uuid;
  IF rv IS NOT NULL THEN peca := public.qualidade_peca(rv); IF peca IS NULL THEN RAISE EXCEPTION 'Peça de reposição não encontrada.'; END IF; END IF;
  IF sol='mesma_peca' OR sol='conserto' THEN
    rref := coalesce(r.rep_referencia, r.dev_referencia); rnome := coalesce(r.rep_nome, r.dev_nome); rtam := coalesce(r.rep_tamanho, r.dev_tamanho); rval := coalesce(r.rep_valor_cents, r.dev_valor_cents);
  ELSE
    rref := coalesce(peca->>'referencia', nullif(d->>'rep_referencia',''), r.rep_referencia); rnome := coalesce(peca->>'nome', nullif(d->>'rep_nome',''), r.rep_nome);
    rtam := coalesce(nullif(d->>'rep_tamanho',''), peca->>'tamanho', r.rep_tamanho); rval := coalesce((peca->>'valor_cents')::int, nullif(d->>'rep_valor_cents','')::int, r.rep_valor_cents);
  END IF;
  IF sol='troca' AND _status IN ('aguardando_envio','resolvida') AND rref IS NULL AND rnome IS NULL THEN RAISE EXCEPTION 'Informe a peça que vai no lugar.'; END IF;
  UPDATE public.qualidade_trocas SET status=_status, solucao=sol,
    rep_variant_id=CASE WHEN sol IN ('mesma_peca','conserto') THEN coalesce(rep_variant_id,dev_variant_id) ELSE coalesce(rv,rep_variant_id) END,
    rep_referencia=upper(rref), rep_nome=rnome, rep_tamanho=rtam, rep_valor_cents=rval,
    diferenca_cents=CASE WHEN rval IS NOT NULL AND dev_valor_cents IS NOT NULL THEN dev_valor_cents-rval ELSE diferenca_cents END,
    parecer=CASE WHEN length(btrim(coalesce(_texto,'')))>0 THEN left(btrim(_texto),2000) ELSE parecer END,
    finalizado_em=CASE WHEN _status IN ('resolvida','recusada') THEN now() WHEN _status IN ('aberta','em_analise','aguardando_envio') THEN NULL ELSE finalizado_em END,
    finalizado_por=CASE WHEN _status IN ('resolvida','recusada') THEN auth.uid() ELSE NULL END,
    finalizado_por_nome=CASE WHEN _status IN ('resolvida','recusada') THEN nome_ator ELSE NULL END,
    transmissao_em=CASE WHEN _status='resolvida' THEN coalesce(transmissao_em, now()) ELSE transmissao_em END,
    transmissao_por_nome=CASE WHEN _status='resolvida' THEN coalesce(transmissao_por_nome, nome_ator) ELSE transmissao_por_nome END,
    novidade_consultora=true, novidade_lardan=false, updated_at=now()
  WHERE id=r.id;
  INSERT INTO public.qualidade_trocas_eventos(troca_id,autor,autor_nome,status,texto,actor_id)
  VALUES(r.id,'lardan',nome_ator,_status,nullif(left(btrim(coalesce(_texto,'')),2000),''),auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.qualidade_troca_mover(uuid,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qualidade_troca_mover(uuid,text,text,jsonb) TO authenticated, service_role;

-- Mensagem nos dois sentidos (nota interna só para a Lardan).
CREATE OR REPLACE FUNCTION public.qualidade_troca_mensagem(_id uuid,_texto text,_fotos jsonb,_interno boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.qualidade_trocas; staff boolean := public.has_capability(auth.uid(),'quality.manage'); dona boolean;
BEGIN
  SELECT * INTO r FROM public.qualidade_trocas WHERE id=_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Solicitação inexistente.'; END IF;
  dona := r.consultora_party_id = public.my_party_id() AND public.has_role(auth.uid(),'consultora');
  IF NOT staff AND NOT dona THEN RAISE EXCEPTION 'Acesso não liberado.'; END IF;
  IF length(btrim(coalesce(_texto,'')))<2 AND jsonb_array_length(coalesce(_fotos,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'Escreva a mensagem ou envie uma foto.'; END IF;
  IF NOT public.qualidade_fotos_validas(_fotos) THEN RAISE EXCEPTION 'Fotos inválidas (até 6, da sua conta).'; END IF;
  INSERT INTO public.qualidade_trocas_eventos(troca_id,autor,autor_nome,texto,fotos,interno,actor_id)
  VALUES(r.id,CASE WHEN staff THEN 'lardan' ELSE 'consultora' END,public.qualidade_ator_nome(),nullif(left(btrim(coalesce(_texto,'')),2000),''),coalesce(_fotos,'[]'::jsonb),staff AND coalesce(_interno,false),auth.uid());
  IF staff THEN
    IF NOT coalesce(_interno,false) THEN UPDATE public.qualidade_trocas SET novidade_consultora=true, novidade_lardan=false, updated_at=now() WHERE id=r.id; END IF;
  ELSE
    UPDATE public.qualidade_trocas SET novidade_lardan=true, novidade_consultora=false, updated_at=now() WHERE id=r.id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.qualidade_troca_mensagem(uuid,text,jsonb,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qualidade_troca_mensagem(uuid,text,jsonb,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.qualidade_troca_marcar_lida(_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF public.has_capability(auth.uid(),'quality.view') THEN UPDATE public.qualidade_trocas SET novidade_lardan=false WHERE id=_id AND novidade_lardan;
  ELSIF public.has_role(auth.uid(),'consultora') THEN UPDATE public.qualidade_trocas SET novidade_consultora=false WHERE id=_id AND novidade_consultora AND consultora_party_id=public.my_party_id();
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.qualidade_troca_marcar_lida(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qualidade_troca_marcar_lida(uuid) TO authenticated, service_role;

-- Busca da Lardan: protocolo, nº antigo, código/nome/CPF da consultora, referência, peça, praça.
CREATE OR REPLACE FUNCTION public.qualidade_troca_buscar(_termo text,_status text,_limite integer DEFAULT 50,_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t text := btrim(coalesce(_termo,'')); n text; res jsonb; total integer;
BEGIN
  IF NOT public.has_capability(auth.uid(),'quality.view') THEN RAISE EXCEPTION 'Acesso não liberado.'; END IF;
  n := regexp_replace(upper(t),'^TG-?0*','');
  WITH base AS (
    SELECT q.*, pa.doc_digits FROM public.qualidade_trocas q JOIN public.parties pa ON pa.id=q.consultora_party_id
    WHERE (coalesce(_status,'')='' OR _status='todas' OR q.status=_status OR (_status='novidades' AND q.novidade_lardan))
      AND (t='' OR (n ~ '^\d+$' AND (q.protocolo::text=n OR q.legado_id::text=t))
        OR upper(coalesce(q.dev_referencia,'')) LIKE upper(t)||'%' OR upper(coalesce(q.rep_referencia,'')) LIKE upper(t)||'%'
        OR public.cidade_norm(coalesce(q.praca_nome,'')) LIKE '%'||public.cidade_norm(t)||'%'
        OR public.cidade_norm(coalesce(q.dev_nome,'')) LIKE '%'||public.cidade_norm(t)||'%'
        OR public.consultora_termo_casa(q.consultora_party_id, q.consultora_nome, q.consultora_codigo, pa.doc_digits, t))
  )
  SELECT count(*)::int, coalesce(jsonb_agg(to_jsonb(x) - 'doc_digits' - 'idempotency_key' ORDER BY x.novidade_lardan DESC, x.aberto_em DESC),'[]'::jsonb)
    INTO total, res
  FROM (SELECT * FROM base ORDER BY novidade_lardan DESC, aberto_em DESC LIMIT least(greatest(coalesce(_limite,50),1),200) OFFSET greatest(coalesce(_offset,0),0)) x;
  SELECT count(*)::int INTO total FROM public.qualidade_trocas q JOIN public.parties pa ON pa.id=q.consultora_party_id
    WHERE (coalesce(_status,'')='' OR _status='todas' OR q.status=_status OR (_status='novidades' AND q.novidade_lardan))
      AND (t='' OR (n ~ '^\d+$' AND (q.protocolo::text=n OR q.legado_id::text=t))
        OR upper(coalesce(q.dev_referencia,'')) LIKE upper(t)||'%' OR upper(coalesce(q.rep_referencia,'')) LIKE upper(t)||'%'
        OR public.cidade_norm(coalesce(q.praca_nome,'')) LIKE '%'||public.cidade_norm(t)||'%'
        OR public.cidade_norm(coalesce(q.dev_nome,'')) LIKE '%'||public.cidade_norm(t)||'%'
        OR public.consultora_termo_casa(q.consultora_party_id, q.consultora_nome, q.consultora_codigo, pa.doc_digits, t));
  RETURN jsonb_build_object('total',total,'itens',res);
END $$;
REVOKE ALL ON FUNCTION public.qualidade_troca_buscar(text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qualidade_troca_buscar(text,text,integer,integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.qualidade_troca_resumo() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE res jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(),'quality.view') THEN RAISE EXCEPTION 'Acesso não liberado.'; END IF;
  SELECT jsonb_build_object(
    'aberta',count(*) FILTER (WHERE status='aberta'),'em_analise',count(*) FILTER (WHERE status='em_analise'),
    'aguardando_envio',count(*) FILTER (WHERE status='aguardando_envio'),'resolvida',count(*) FILTER (WHERE status='resolvida'),
    'recusada',count(*) FILTER (WHERE status='recusada'),'todas',count(*),'novidades',count(*) FILTER (WHERE novidade_lardan),
    'consultoras_pendentes',count(DISTINCT consultora_party_id) FILTER (WHERE status IN ('aberta','em_analise','aguardando_envio')),
    'abertas_mais_30d',count(*) FILTER (WHERE status IN ('aberta','em_analise') AND aberto_em < now()-interval '30 days'),
    'resolvidas_30d',count(*) FILTER (WHERE status='resolvida' AND finalizado_em >= now()-interval '30 days'),
    'dias_medios_resolucao',round(avg(extract(epoch FROM finalizado_em-aberto_em)/86400) FILTER (WHERE status='resolvida' AND finalizado_em >= now()-interval '180 days')::numeric,1),
    'diferenca_cents_30d',coalesce(sum(diferenca_cents) FILTER (WHERE status='resolvida' AND finalizado_em >= now()-interval '30 days'),0)
  ) INTO res FROM public.qualidade_trocas;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.qualidade_troca_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qualidade_troca_resumo() TO authenticated, service_role;

-- Fotos: Lardan envia na própria pasta e lê todas do bucket; consultora lê as fotos das suas trocas.
CREATE POLICY qualidade_foto_inserir_lardan ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='consultora-pos-venda' AND (storage.foldername(name))[1]=auth.uid()::text AND (SELECT public.has_capability(auth.uid(),'quality.manage'))
  AND lower(storage.extension(name)) IN ('jpg','jpeg','png','webp'));
CREATE POLICY qualidade_foto_ler_lardan ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='consultora-pos-venda' AND (SELECT public.has_capability(auth.uid(),'quality.view')));
CREATE POLICY qualidade_foto_ler_consultora ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='consultora-pos-venda' AND EXISTS(SELECT 1 FROM public.qualidade_trocas_eventos e JOIN public.qualidade_trocas t ON t.id=e.troca_id
    WHERE NOT e.interno AND e.fotos ? name AND t.consultora_party_id=(SELECT public.my_party_id())));

COMMENT ON TABLE public.qualidade_trocas IS 'Setor de Qualidade: trocas/garantias de maleta e pedido, mão dupla consultora/Lardan. Nunca move estoque, crédito ou dinheiro sozinho.';
COMMENT ON TABLE public.consultora_pos_venda IS 'DEPRECATED: substituída por qualidade_trocas (canal único de trocas e garantias).';