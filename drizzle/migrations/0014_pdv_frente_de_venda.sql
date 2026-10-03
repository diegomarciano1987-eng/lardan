-- PDV: acesso por número + senha da loja, PIN da vendedora, caixa, vendas, pagamentos, comissão e Pix Asaas.
ALTER TABLE public.pdv_unidades ADD COLUMN IF NOT EXISTS numero text UNIQUE;
ALTER TABLE public.pdv_unidades ADD COLUMN IF NOT EXISTS senha_hash text;
ALTER TABLE public.pdv_unidades ADD COLUMN IF NOT EXISTS senha_alterada_em timestamptz;
ALTER TABLE public.pdv_unidades ADD COLUMN IF NOT EXISTS pix_responsavel_user_id uuid;
ALTER TABLE public.pdv_membros ADD COLUMN IF NOT EXISTS pin_hash text;
ALTER TABLE public.pdv_unidades ADD CONSTRAINT pdv_unidades_numero_fmt CHECK (numero IS NULL OR numero ~ '^[0-9]{3,10}$');

CREATE TABLE public.pdv_sessoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id uuid NOT NULL REFERENCES public.pdv_unidades(id),
  token_hash text NOT NULL UNIQUE,
  membro_id uuid REFERENCES public.pdv_membros(id),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  ultimo_uso timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL DEFAULT now() + interval '16 hours',
  revogada_em timestamptz);

CREATE TABLE public.pdv_login_tentativas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL, ok boolean NOT NULL, tipo text NOT NULL DEFAULT 'loja',
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON public.pdv_login_tentativas(numero, created_at);

CREATE TABLE public.pdv_caixas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id uuid NOT NULL REFERENCES public.pdv_unidades(id),
  status text NOT NULL DEFAULT 'aberto' CHECK (status in ('aberto','fechado')),
  aberto_por uuid NOT NULL REFERENCES public.pdv_membros(id),
  aberto_em timestamptz NOT NULL DEFAULT now(),
  fundo_cents bigint NOT NULL CHECK (fundo_cents >= 0),
  fechado_por uuid REFERENCES public.pdv_membros(id),
  fechado_em timestamptz,
  esperado_cents bigint, contado_cents bigint, observacao text);
CREATE UNIQUE INDEX pdv_um_caixa_aberto ON public.pdv_caixas(unidade_id) WHERE status='aberto';

CREATE TABLE public.pdv_caixa_movs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caixa_id uuid NOT NULL REFERENCES public.pdv_caixas(id),
  tipo text NOT NULL CHECK (tipo in ('sangria','suprimento')),
  valor_cents bigint NOT NULL CHECK (valor_cents > 0),
  motivo text NOT NULL, membro_id uuid NOT NULL REFERENCES public.pdv_membros(id),
  created_at timestamptz NOT NULL DEFAULT now());

CREATE SEQUENCE public.pdv_venda_seq START 1;
CREATE TABLE public.pdv_vendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo bigint NOT NULL UNIQUE DEFAULT nextval('public.pdv_venda_seq'),
  unidade_id uuid NOT NULL REFERENCES public.pdv_unidades(id),
  caixa_id uuid NOT NULL REFERENCES public.pdv_caixas(id),
  membro_id uuid NOT NULL REFERENCES public.pdv_membros(id),
  status text NOT NULL CHECK (status in ('aguardando_pix','concluida','cancelada')),
  subtotal_cents bigint NOT NULL, desconto_cents bigint NOT NULL DEFAULT 0, total_cents bigint NOT NULL,
  cliente_nome text, cliente_doc text, cliente_telefone text, party_id uuid,
  title_id uuid, installment_id uuid, pix_charge_id uuid, pix_url text,
  comissao_pct numeric(5,2), comissao_cents bigint,
  idempotency_key text UNIQUE,
  cancel_motivo text, cancelada_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(), concluida_em timestamptz);

CREATE TABLE public.pdv_venda_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venda_id uuid NOT NULL REFERENCES public.pdv_vendas(id),
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  sku text, nome text NOT NULL, qtd int NOT NULL CHECK (qtd > 0),
  preco_unit_cents bigint NOT NULL, total_cents bigint NOT NULL);

CREATE TABLE public.pdv_pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venda_id uuid NOT NULL REFERENCES public.pdv_vendas(id),
  forma text NOT NULL CHECK (forma in ('dinheiro','debito','credito','pix')),
  valor_cents bigint NOT NULL CHECK (valor_cents > 0),
  recebido_cents bigint, troco_cents bigint NOT NULL DEFAULT 0,
  maquininha_id uuid REFERENCES public.pdv_maquininhas(id), parcelas int, nsu text,
  status text NOT NULL DEFAULT 'confirmado' CHECK (status in ('confirmado','pendente','cancelado')),
  created_at timestamptz NOT NULL DEFAULT now());

GRANT SELECT ON public.pdv_sessoes, public.pdv_caixas, public.pdv_caixa_movs, public.pdv_vendas, public.pdv_venda_itens, public.pdv_pagamentos TO authenticated;
GRANT ALL ON public.pdv_sessoes, public.pdv_login_tentativas, public.pdv_caixas, public.pdv_caixa_movs, public.pdv_vendas, public.pdv_venda_itens, public.pdv_pagamentos TO service_role;
GRANT USAGE ON SEQUENCE public.pdv_venda_seq TO service_role;
ALTER TABLE public.pdv_sessoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdv_login_tentativas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdv_caixas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdv_caixa_movs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdv_vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdv_venda_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdv_pagamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY gestao_le ON public.pdv_sessoes FOR SELECT TO authenticated USING (public.pdv_gestao(auth.uid()));
CREATE POLICY gestao_le ON public.pdv_caixas FOR SELECT TO authenticated USING (public.pdv_gestao(auth.uid()));
CREATE POLICY gestao_le ON public.pdv_caixa_movs FOR SELECT TO authenticated USING (public.pdv_gestao(auth.uid()));
CREATE POLICY gestao_le ON public.pdv_vendas FOR SELECT TO authenticated USING (public.pdv_gestao(auth.uid()));
CREATE POLICY gestao_le ON public.pdv_venda_itens FOR SELECT TO authenticated USING (public.pdv_gestao(auth.uid()));
CREATE POLICY gestao_le ON public.pdv_pagamentos FOR SELECT TO authenticated USING (public.pdv_gestao(auth.uid()));

-- Colunas sensíveis nunca saem para o navegador
REVOKE SELECT (senha_hash) ON public.pdv_unidades FROM authenticated;
REVOKE SELECT ON public.pdv_unidades FROM authenticated;
GRANT SELECT (id,nome,location_id,business_entity_id,conta_dinheiro_id,conta_cartao_id,conta_pix_id,regra_preco,desconto_max_operadora_pct,desconto_max_supervisora_pct,reserva_minutos,comissao_libera_em,texto_comprovante,ativo,updated_by,updated_at,created_at,numero,senha_alterada_em,pix_responsavel_user_id) ON public.pdv_unidades TO authenticated;
REVOKE SELECT ON public.pdv_membros FROM authenticated;
GRANT SELECT (id,unidade_id,user_id,papel,vende,ativo,created_by,created_at,updated_at) ON public.pdv_membros TO authenticated;

-- ===== Gestão (Master/Diretoria) =====
CREATE OR REPLACE FUNCTION public.pdv_unidade_criar(_nome text, _numero text, _senha text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, extensions AS $$
DECLARE loc uuid; uid uuid;
BEGIN
  IF NOT public.pdv_gestao(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF nullif(trim(_nome),'') IS NULL THEN RAISE EXCEPTION 'Informe o nome da loja.'; END IF;
  IF _numero !~ '^[0-9]{3,10}$' THEN RAISE EXCEPTION 'O número da loja deve ter de 3 a 10 dígitos.'; END IF;
  IF length(coalesce(_senha,'')) < 6 THEN RAISE EXCEPTION 'A senha precisa de pelo menos 6 caracteres.'; END IF;
  IF EXISTS(select 1 from pdv_unidades where numero=_numero) THEN RAISE EXCEPTION 'Já existe uma loja com o número %.', _numero; END IF;
  INSERT INTO locations(code,name,kind,created_by) VALUES ('LOJA-'||_numero, upper(trim(_nome)), 'loja', auth.uid()) RETURNING id INTO loc;
  INSERT INTO pdv_unidades(nome,location_id,numero,senha_hash,senha_alterada_em,updated_by)
  VALUES (upper(trim(_nome)), loc, _numero, crypt(_senha, gen_salt('bf')), now(), auth.uid()) RETURNING id INTO uid;
  RETURN uid;
END $$;

CREATE OR REPLACE FUNCTION public.pdv_unidade_acesso(_unidade uuid, _numero text, _senha text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, extensions AS $$
BEGIN
  IF NOT public.pdv_gestao(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF _numero !~ '^[0-9]{3,10}$' THEN RAISE EXCEPTION 'O número da loja deve ter de 3 a 10 dígitos.'; END IF;
  IF EXISTS(select 1 from pdv_unidades where numero=_numero and id<>_unidade) THEN RAISE EXCEPTION 'Já existe uma loja com o número %.', _numero; END IF;
  UPDATE pdv_unidades SET numero=_numero, updated_by=auth.uid(), updated_at=now() WHERE id=_unidade;
  IF nullif(_senha,'') IS NOT NULL THEN
    IF length(_senha) < 6 THEN RAISE EXCEPTION 'A senha precisa de pelo menos 6 caracteres.'; END IF;
    UPDATE pdv_unidades SET senha_hash=crypt(_senha, gen_salt('bf')), senha_alterada_em=now() WHERE id=_unidade;
    UPDATE pdv_sessoes SET revogada_em=now() WHERE unidade_id=_unidade AND revogada_em IS NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.pdv_membro_pin(_membro uuid, _pin text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, extensions AS $$
BEGIN
  IF NOT public.pdv_gestao(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF _pin !~ '^[0-9]{4,6}$' THEN RAISE EXCEPTION 'O PIN deve ter de 4 a 6 números.'; END IF;
  UPDATE pdv_membros SET pin_hash=crypt(_pin, gen_salt('bf')), updated_at=now() WHERE id=_membro;
  INSERT INTO pdv_config_eventos(unidade_id,tabela,registro_id,acao,dados,autor_id)
  SELECT unidade_id,'pdv_membros',id,'PIN',jsonb_build_object('pin','definido'),auth.uid() FROM pdv_membros WHERE id=_membro;
END $$;

CREATE OR REPLACE FUNCTION public.pdv_membros_pin_status(_unidade uuid) RETURNS TABLE(membro_id uuid, tem_pin boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  select id, pin_hash is not null from pdv_membros where unidade_id=_unidade and public.pdv_gestao(auth.uid()) $$;

GRANT EXECUTE ON FUNCTION public.pdv_unidade_criar(text,text,text), public.pdv_unidade_acesso(uuid,text,text), public.pdv_membro_pin(uuid,text), public.pdv_membros_pin_status(uuid) TO authenticated;

-- ===== Operação da loja (somente servidor, com token da sessão do terminal) =====
CREATE OR REPLACE FUNCTION public.pdv_sessao(_token_hash text) RETURNS public.pdv_sessoes
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes;
BEGIN
  SELECT * INTO s FROM pdv_sessoes WHERE token_hash=_token_hash AND revogada_em IS NULL AND expira_em > now();
  IF s.id IS NULL THEN RAISE EXCEPTION 'PDV_SESSAO_INVALIDA'; END IF;
  IF NOT EXISTS(select 1 from pdv_unidades where id=s.unidade_id and ativo) THEN RAISE EXCEPTION 'Loja desativada.'; END IF;
  UPDATE pdv_sessoes SET ultimo_uso=now() WHERE id=s.id;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public.pdv_entrar(_numero text, _senha text, _token_hash text, _ua text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, extensions AS $$
DECLARE u pdv_unidades; falhas int;
BEGIN
  SELECT count(*) INTO falhas FROM pdv_login_tentativas WHERE numero=_numero AND NOT ok AND tipo='loja' AND created_at > now()-interval '15 minutes';
  IF falhas >= 5 THEN RAISE EXCEPTION 'Muitas tentativas. Aguarde 15 minutos.'; END IF;
  SELECT * INTO u FROM pdv_unidades WHERE numero=_numero AND ativo;
  IF u.id IS NULL OR u.senha_hash IS NULL OR u.senha_hash <> crypt(coalesce(_senha,''), u.senha_hash) THEN
    INSERT INTO pdv_login_tentativas(numero,ok) VALUES (coalesce(_numero,''),false);
    RAISE EXCEPTION 'Número da loja ou senha incorretos.';
  END IF;
  INSERT INTO pdv_login_tentativas(numero,ok) VALUES (_numero,true);
  INSERT INTO pdv_sessoes(unidade_id,token_hash,user_agent) VALUES (u.id,_token_hash,left(_ua,300));
  RETURN jsonb_build_object('unidade', u.nome, 'numero', u.numero);
END $$;

CREATE OR REPLACE FUNCTION public.pdv_sair(_token_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  update pdv_sessoes set revogada_em=now() where token_hash=_token_hash and revogada_em is null $$;

CREATE OR REPLACE FUNCTION public.pdv_operadora(_token_hash text, _membro uuid, _pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, extensions AS $$
DECLARE s pdv_sessoes; m pdv_membros; falhas int;
BEGIN
  s := public.pdv_sessao(_token_hash);
  SELECT * INTO m FROM pdv_membros WHERE id=_membro AND unidade_id=s.unidade_id AND ativo;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Vendedora não pertence a esta loja.'; END IF;
  SELECT count(*) INTO falhas FROM pdv_login_tentativas WHERE numero=_membro::text AND NOT ok AND created_at > now()-interval '15 minutes';
  IF falhas >= 5 THEN RAISE EXCEPTION 'PIN bloqueado por 15 minutos.'; END IF;
  IF m.pin_hash IS NULL THEN RAISE EXCEPTION 'PIN ainda não definido pela gestão.'; END IF;
  IF m.pin_hash <> crypt(coalesce(_pin,''), m.pin_hash) THEN
    INSERT INTO pdv_login_tentativas(numero,ok,tipo) VALUES (_membro::text,false,'pin');
    RAISE EXCEPTION 'PIN incorreto.';
  END IF;
  UPDATE pdv_sessoes SET membro_id=m.id WHERE id=s.id;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.pdv_operadora_sair(_token_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; BEGIN s := public.pdv_sessao(_token_hash); UPDATE pdv_sessoes SET membro_id=null WHERE id=s.id; END $$;

CREATE OR REPLACE FUNCTION public.pdv_nome_usuario(_u uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  select coalesce(nullif(display_name,''), nullif(full_name,''), split_part(email,'@',1), 'Vendedora') from profiles where id=_u $$;

CREATE OR REPLACE FUNCTION public.pdv_caixa_esperado(_caixa uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  select c.fundo_cents
   + coalesce((select sum(p.valor_cents) from pdv_pagamentos p join pdv_vendas v on v.id=p.venda_id where v.caixa_id=c.id and p.forma='dinheiro' and p.status='confirmado' and v.status<>'cancelada'),0)
   + coalesce((select sum(case when tipo='suprimento' then valor_cents else -valor_cents end) from pdv_caixa_movs where caixa_id=c.id),0)
  from pdv_caixas c where c.id=_caixa $$;

CREATE OR REPLACE FUNCTION public.pdv_estado(_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; u pdv_unidades; cx pdv_caixas; r jsonb; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
BEGIN
  s := public.pdv_sessao(_token_hash);
  SELECT * INTO u FROM pdv_unidades WHERE id=s.unidade_id;
  SELECT * INTO cx FROM pdv_caixas WHERE unidade_id=u.id AND status='aberto';
  r := jsonb_build_object(
    'unidade', jsonb_build_object('nome',u.nome,'numero',u.numero,'desc_operadora',u.desconto_max_operadora_pct,'desc_supervisora',u.desconto_max_supervisora_pct,'rodape',u.texto_comprovante,'pix', u.pix_responsavel_user_id is not null and u.business_entity_id is not null),
    'membros', coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'nome',public.pdv_nome_usuario(m.user_id),'papel',m.papel,'tem_pin',m.pin_hash is not null) order by public.pdv_nome_usuario(m.user_id)) from pdv_membros m where m.unidade_id=u.id and m.ativo and (m.vende or m.papel='supervisora')),'[]'),
    'operadora', (select jsonb_build_object('id',m.id,'nome',public.pdv_nome_usuario(m.user_id),'papel',m.papel) from pdv_membros m where m.id=s.membro_id and m.ativo),
    'maquininhas', coalesce((select jsonb_agg(jsonb_build_object('id',id,'nome',nome,'max_parcelas',max_parcelas) order by nome) from pdv_maquininhas where unidade_id=u.id and ativo),'[]'),
    'caixa', CASE WHEN cx.id IS NULL THEN null ELSE jsonb_build_object('id',cx.id,'aberto_em',cx.aberto_em,'fundo',cx.fundo_cents,'esperado',public.pdv_caixa_esperado(cx.id),
       'aberto_por', (select public.pdv_nome_usuario(user_id) from pdv_membros where id=cx.aberto_por),
       'por_forma', coalesce((select jsonb_object_agg(forma, t) from (select p.forma, sum(p.valor_cents) t from pdv_pagamentos p join pdv_vendas v on v.id=p.venda_id where v.caixa_id=cx.id and v.status<>'cancelada' and p.status='confirmado' group by 1) z),'{}'),
       'vendas', (select count(*) from pdv_vendas where caixa_id=cx.id and status='concluida')) END,
    'hoje', coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'codigo',v.codigo,'total',v.total_cents,'status',v.status,'hora',v.created_at,'vendedora',public.pdv_nome_usuario(m.user_id)) order by v.created_at desc)
        from pdv_vendas v join pdv_membros m on m.id=v.membro_id where v.unidade_id=u.id and (v.created_at at time zone 'America/Sao_Paulo')::date=hoje),'[]'));
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.pdv_exigir_operadora(s public.pdv_sessoes) RETURNS public.pdv_membros
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m pdv_membros; BEGIN
  SELECT * INTO m FROM pdv_membros WHERE id=s.membro_id AND ativo;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Escolha a vendedora e digite o PIN.'; END IF;
  RETURN m; END $$;

CREATE OR REPLACE FUNCTION public.pdv_caixa_abrir(_token_hash text, _fundo bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; m pdv_membros; id uuid;
BEGIN
  s := public.pdv_sessao(_token_hash); m := public.pdv_exigir_operadora(s);
  IF coalesce(_fundo,-1) < 0 THEN RAISE EXCEPTION 'Informe o fundo de troco.'; END IF;
  IF EXISTS(select 1 from pdv_caixas where unidade_id=s.unidade_id and status='aberto') THEN RAISE EXCEPTION 'Já existe um caixa aberto.'; END IF;
  INSERT INTO pdv_caixas(unidade_id,aberto_por,fundo_cents) VALUES (s.unidade_id,m.id,_fundo) RETURNING pdv_caixas.id INTO id;
  RETURN id;
END $$;

CREATE OR REPLACE FUNCTION public.pdv_caixa_mov(_token_hash text, _tipo text, _valor bigint, _motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; m pdv_membros; cx uuid;
BEGIN
  s := public.pdv_sessao(_token_hash); m := public.pdv_exigir_operadora(s);
  SELECT id INTO cx FROM pdv_caixas WHERE unidade_id=s.unidade_id AND status='aberto';
  IF cx IS NULL THEN RAISE EXCEPTION 'Abra o caixa primeiro.'; END IF;
  IF nullif(trim(_motivo),'') IS NULL THEN RAISE EXCEPTION 'Escreva o motivo.'; END IF;
  IF _tipo='sangria' AND _valor > public.pdv_caixa_esperado(cx) THEN RAISE EXCEPTION 'A sangria é maior que o dinheiro na gaveta.'; END IF;
  INSERT INTO pdv_caixa_movs(caixa_id,tipo,valor_cents,motivo,membro_id) VALUES (cx,_tipo,_valor,trim(_motivo),m.id);
END $$;

CREATE OR REPLACE FUNCTION public.pdv_caixa_fechar(_token_hash text, _contado bigint, _obs text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; m pdv_membros; cx pdv_caixas; esp bigint;
BEGIN
  s := public.pdv_sessao(_token_hash); m := public.pdv_exigir_operadora(s);
  SELECT * INTO cx FROM pdv_caixas WHERE unidade_id=s.unidade_id AND status='aberto' FOR UPDATE;
  IF cx.id IS NULL THEN RAISE EXCEPTION 'Não há caixa aberto.'; END IF;
  IF coalesce(_contado,-1) < 0 THEN RAISE EXCEPTION 'Informe o dinheiro contado.'; END IF;
  IF EXISTS(select 1 from pdv_vendas where caixa_id=cx.id and status='aguardando_pix') THEN RAISE EXCEPTION 'Há venda aguardando Pix. Conclua ou cancele antes de fechar.'; END IF;
  esp := public.pdv_caixa_esperado(cx.id);
  IF _contado <> esp AND nullif(trim(coalesce(_obs,'')),'') IS NULL THEN RAISE EXCEPTION 'O dinheiro contado difere do esperado. Explique a diferença.'; END IF;
  UPDATE pdv_caixas SET status='fechado', fechado_por=m.id, fechado_em=now(), esperado_cents=esp, contado_cents=_contado, observacao=nullif(trim(_obs),'') WHERE id=cx.id;
  RETURN jsonb_build_object('caixa',cx.id,'esperado',esp,'contado',_contado,'diferenca',_contado-esp);
END $$;

CREATE OR REPLACE FUNCTION public.pdv_preco(_variant uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  select coalesce(nullif(v.price_cents,0), nullif(p.price_cents,0))::bigint from product_variants v join products p on p.id=v.product_id where v.id=_variant $$;

CREATE OR REPLACE FUNCTION public.pdv_produto_buscar(_token_hash text, _q text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; loc uuid; q text := trim(coalesce(_q,''));
BEGIN
  s := public.pdv_sessao(_token_hash);
  SELECT location_id INTO loc FROM pdv_unidades WHERE id=s.unidade_id;
  IF length(q) < 2 THEN RETURN '[]'; END IF;
  RETURN coalesce((select jsonb_agg(x) from (
    select v.id, coalesce(v.sku, v.reference_code) sku, p.name || coalesce(' — '||nullif(v.label,''),'') nome, public.pdv_preco(v.id) preco,
           coalesce((select quantity from stock_balances b where b.variant_id=v.id and b.location_id=loc),0) saldo,
           (v.barcode=q or v.sku=q or v.reference_code=q or v.legacy_code=q) exato
    from product_variants v join products p on p.id=v.product_id
    where v.is_active and (v.barcode=q or v.sku ilike q or v.reference_code ilike q or v.legacy_code=q or p.name ilike '%'||q||'%')
    order by 6 desc, 5 desc, 3 limit 12) x),'[]');
END $$;

CREATE OR REPLACE FUNCTION public.pdv_venda_concluir(_token_hash text, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; m pdv_membros; u pdv_unidades; cx uuid; vid uuid; ex pdv_vendas;
  it jsonb; pg jsonb; preco bigint; sub bigint := 0; desc_c bigint; tot bigint; soma bigint := 0; tem_pix boolean := false;
  lim numeric; com pdv_comissoes; nm text; sk text; q int; mov_saldo int; codigo bigint; troco bigint; uid uuid;
BEGIN
  s := public.pdv_sessao(_token_hash); m := public.pdv_exigir_operadora(s);
  IF NOT m.vende THEN RAISE EXCEPTION 'Esta pessoa não está liberada para vender.'; END IF;
  SELECT * INTO u FROM pdv_unidades WHERE id=s.unidade_id;
  SELECT id INTO cx FROM pdv_caixas WHERE unidade_id=u.id AND status='aberto';
  IF cx IS NULL THEN RAISE EXCEPTION 'Abra o caixa antes de vender.'; END IF;
  IF nullif(_p->>'idem','') IS NULL THEN RAISE EXCEPTION 'Venda sem identificador.'; END IF;
  SELECT * INTO ex FROM pdv_vendas WHERE idempotency_key=_p->>'idem';
  IF ex.id IS NOT NULL THEN RETURN jsonb_build_object('venda',ex.id,'codigo',ex.codigo,'status',ex.status,'repetida',true); END IF;
  IF jsonb_array_length(coalesce(_p->'itens','[]')) = 0 THEN RAISE EXCEPTION 'Adicione ao menos uma peça.'; END IF;
  SELECT user_id INTO uid FROM pdv_membros WHERE id=m.id;

  INSERT INTO pdv_vendas(unidade_id,caixa_id,membro_id,status,subtotal_cents,total_cents,idempotency_key,cliente_nome,cliente_doc,cliente_telefone)
  VALUES (u.id,cx,m.id,'concluida',0,0,_p->>'idem',nullif(trim(_p#>>'{cliente,nome}'),''),nullif(regexp_replace(coalesce(_p#>>'{cliente,doc}',''),'\D','','g'),''),nullif(regexp_replace(coalesce(_p#>>'{cliente,telefone}',''),'\D','','g'),''))
  RETURNING id, pdv_vendas.codigo INTO vid, codigo;

  FOR it IN SELECT * FROM jsonb_array_elements(_p->'itens') LOOP
    q := (it->>'qtd')::int;
    IF q IS NULL OR q <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
    preco := public.pdv_preco((it->>'variant_id')::uuid);
    IF preco IS NULL THEN RAISE EXCEPTION 'Peça sem preço cadastrado.'; END IF;
    SELECT p.name || coalesce(' — '||nullif(v.label,''),''), coalesce(v.sku,v.reference_code) INTO nm, sk FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=(it->>'variant_id')::uuid;
    INSERT INTO pdv_venda_itens(venda_id,variant_id,sku,nome,qtd,preco_unit_cents,total_cents) VALUES (vid,(it->>'variant_id')::uuid,sk,nm,q,preco,preco*q);
    sub := sub + preco*q;
    BEGIN
      mov_saldo := public.apply_stock_delta((it->>'variant_id')::uuid, u.location_id, -q);
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'Sem estoque na loja para "%".', nm; END;
    INSERT INTO stock_movements(kind,variant_id,from_location_id,quantity,reason_code,reference,note,balance_after,created_by,idempotency_key,balance_from_after,balance_from_before)
    VALUES ('saida',(it->>'variant_id')::uuid,u.location_id,q,'venda','PDV-'||codigo,'Venda PDV '||u.nome,mov_saldo,uid,'pdv:'||vid||':'||(it->>'variant_id')||':'||gen_random_uuid(),mov_saldo,mov_saldo+q);
  END LOOP;

  desc_c := coalesce((_p->>'desconto_cents')::bigint,0);
  IF desc_c < 0 OR desc_c >= sub THEN RAISE EXCEPTION 'Desconto inválido.'; END IF;
  lim := CASE WHEN m.papel IN ('supervisora','gestao') THEN u.desconto_max_supervisora_pct ELSE u.desconto_max_operadora_pct END;
  IF desc_c > floor(sub * lim / 100) THEN RAISE EXCEPTION 'Desconto acima do limite de %%% para %.', lim, CASE WHEN m.papel='operadora' THEN 'vendedora' ELSE 'supervisora' END; END IF;
  tot := sub - desc_c;

  FOR pg IN SELECT * FROM jsonb_array_elements(coalesce(_p->'pagamentos','[]')) LOOP
    IF (pg->>'valor_cents')::bigint <= 0 THEN RAISE EXCEPTION 'Pagamento com valor inválido.'; END IF;
    IF pg->>'forma' IN ('debito','credito') AND NOT EXISTS(select 1 from pdv_maquininhas where id=(pg->>'maquininha_id')::uuid and unidade_id=u.id and ativo) THEN RAISE EXCEPTION 'Escolha a maquininha do cartão.'; END IF;
    troco := 0;
    IF pg->>'forma'='dinheiro' THEN
      troco := greatest(coalesce((pg->>'recebido_cents')::bigint,(pg->>'valor_cents')::bigint) - (pg->>'valor_cents')::bigint, 0);
    END IF;
    IF pg->>'forma'='pix' THEN tem_pix := true; END IF;
    INSERT INTO pdv_pagamentos(venda_id,forma,valor_cents,recebido_cents,troco_cents,maquininha_id,parcelas,nsu,status)
    VALUES (vid,pg->>'forma',(pg->>'valor_cents')::bigint,(pg->>'recebido_cents')::bigint,troco,nullif(pg->>'maquininha_id','')::uuid,nullif(pg->>'parcelas','')::int,nullif(trim(pg->>'nsu'),''),CASE WHEN pg->>'forma'='pix' THEN 'pendente' ELSE 'confirmado' END);
    soma := soma + (pg->>'valor_cents')::bigint;
  END LOOP;
  IF soma <> tot THEN RAISE EXCEPTION 'Os pagamentos (%) não fecham o total da venda (%).', soma, tot; END IF;
  IF (select count(*) from pdv_pagamentos where venda_id=vid and forma='pix') > 1 THEN RAISE EXCEPTION 'Use um único Pix por venda.'; END IF;
  IF tem_pix THEN
    IF NOT (u.pix_responsavel_user_id IS NOT NULL AND u.business_entity_id IS NOT NULL) THEN RAISE EXCEPTION 'Pix ainda não configurado para esta loja.'; END IF;
    IF length(coalesce(regexp_replace(_p#>>'{cliente,doc}','\D','','g'),'')) NOT IN (11,14) OR nullif(trim(_p#>>'{cliente,nome}'),'') IS NULL THEN
      RAISE EXCEPTION 'Para Pix, informe nome e CPF da cliente.'; END IF;
  END IF;

  SELECT * INTO com FROM pdv_comissoes WHERE membro_id=m.id AND vigente_de <= current_date AND (vigente_ate IS NULL OR vigente_ate > current_date) ORDER BY vigente_de DESC LIMIT 1;
  UPDATE pdv_vendas SET subtotal_cents=sub, desconto_cents=desc_c, total_cents=tot,
    status=CASE WHEN tem_pix THEN 'aguardando_pix' ELSE 'concluida' END,
    concluida_em=CASE WHEN tem_pix THEN null ELSE now() END,
    comissao_pct=com.percentual,
    comissao_cents=CASE WHEN com.id IS NULL THEN null ELSE round((CASE WHEN com.base='bruto' THEN sub ELSE tot END) * com.percentual / 100) END
  WHERE id=vid;
  RETURN jsonb_build_object('venda',vid,'codigo',codigo,'status',CASE WHEN tem_pix THEN 'aguardando_pix' ELSE 'concluida' END,'total',tot);
END $$;

-- Pix: cria título a receber e prepara a cobrança Asaas em nome do responsável configurado pela gestão.
CREATE OR REPLACE FUNCTION public.pdv_como(_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub',_actor,'role','authenticated')::text, true); END $$;
REVOKE ALL ON FUNCTION public.pdv_como(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pdv_pix_titulo(_token_hash text, _venda uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; u pdv_unidades; v pdv_vendas; pv bigint; party uuid; tid uuid; inst uuid; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
BEGIN
  s := public.pdv_sessao(_token_hash);
  SELECT * INTO v FROM pdv_vendas WHERE id=_venda AND unidade_id=s.unidade_id FOR UPDATE;
  IF v.id IS NULL OR v.status<>'aguardando_pix' THEN RAISE EXCEPTION 'Venda não está aguardando Pix.'; END IF;
  SELECT * INTO u FROM pdv_unidades WHERE id=v.unidade_id;
  IF v.installment_id IS NOT NULL THEN RETURN jsonb_build_object('installment_id',v.installment_id,'actor',u.pix_responsavel_user_id); END IF;
  SELECT valor_cents INTO pv FROM pdv_pagamentos WHERE venda_id=v.id AND forma='pix';
  SELECT id INTO party FROM parties WHERE doc_digits=v.cliente_doc AND is_active ORDER BY created_at LIMIT 1;
  IF party IS NULL THEN
    INSERT INTO parties(kind,display_name,legal_name,doc,doc_digits,status,created_by) VALUES (CASE WHEN length(v.cliente_doc)=14 THEN 'organizacao' ELSE 'pessoa' END::party_kind, v.cliente_nome, v.cliente_nome, v.cliente_doc, v.cliente_doc,'ativo',u.pix_responsavel_user_id) RETURNING id INTO party;
    INSERT INTO party_roles(party_id,role,created_by) VALUES (party,'cliente',u.pix_responsavel_user_id);
  END IF;
  PERFORM public.pdv_como(u.pix_responsavel_user_id);
  tid := public.fin_title_create(jsonb_build_object('direction','receivable','business_entity_id',u.business_entity_id,'party_id',party,
     'descricao','Venda PDV '||u.nome||' nº '||v.codigo,'documento','PDV-'||v.codigo,'emissao',hoje,'competencia',hoje,'valor_cents',pv,
     'financial_account_id',u.conta_pix_id,'origem','pdv','id_externo','pdv:'||v.id,'status','ativo',
     'parcelas',jsonb_build_array(jsonb_build_object('valor_cents',pv,'vencimento',hoje))));
  SELECT id INTO inst FROM financial_installments WHERE title_id=tid ORDER BY numero LIMIT 1;
  UPDATE pdv_vendas SET party_id=party, title_id=tid, installment_id=inst WHERE id=v.id;
  RETURN jsonb_build_object('installment_id',inst,'actor',u.pix_responsavel_user_id);
END $$;

CREATE OR REPLACE FUNCTION public.pdv_asaas_preparar(_actor uuid, _payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT EXISTS(select 1 from pdv_unidades where pix_responsavel_user_id=_actor) THEN RAISE EXCEPTION 'Responsável Pix inválido.'; END IF;
  IF NOT EXISTS(select 1 from pdv_vendas where installment_id=(_payload->>'installment_id')::uuid and status='aguardando_pix') THEN RAISE EXCEPTION 'Parcela não pertence a venda do PDV.'; END IF;
  PERFORM public.pdv_como(_actor);
  SELECT to_jsonb(x) INTO r FROM (SELECT public.asaas_cobranca_preparar(_payload) AS v) z, LATERAL (SELECT z.v) x(v);
  RETURN r->'v';
END $$;

CREATE OR REPLACE FUNCTION public.pdv_pix_registrar(_token_hash text, _venda uuid, _charge uuid, _url text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; BEGIN
  s := public.pdv_sessao(_token_hash);
  UPDATE pdv_vendas SET pix_charge_id=coalesce(_charge,pix_charge_id), pix_url=coalesce(_url,pix_url) WHERE id=_venda AND unidade_id=s.unidade_id;
END $$;

CREATE OR REPLACE FUNCTION public.pdv_pix_situacao(_token_hash text, _venda uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; v pdv_vendas; saldo bigint;
BEGIN
  s := public.pdv_sessao(_token_hash);
  SELECT * INTO v FROM pdv_vendas WHERE id=_venda AND unidade_id=s.unidade_id FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF v.status='aguardando_pix' AND v.installment_id IS NOT NULL THEN
    saldo := public.fin_installment_saldo(v.installment_id);
    IF coalesce(saldo,1) <= 0 THEN
      UPDATE pdv_pagamentos SET status='confirmado' WHERE venda_id=v.id AND forma='pix';
      UPDATE pdv_vendas SET status='concluida', concluida_em=now() WHERE id=v.id;
      v.status := 'concluida';
    END IF;
  END IF;
  RETURN jsonb_build_object('status',v.status,'pix_url',v.pix_url);
END $$;

CREATE OR REPLACE FUNCTION public.pdv_venda_cancelar(_token_hash text, _venda uuid, _motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; m pdv_membros; v pdv_vendas; u pdv_unidades; it record; saldo int; uid uuid;
BEGIN
  s := public.pdv_sessao(_token_hash); m := public.pdv_exigir_operadora(s);
  SELECT * INTO v FROM pdv_vendas WHERE id=_venda AND unidade_id=s.unidade_id FOR UPDATE;
  IF v.id IS NULL OR v.status='cancelada' THEN RAISE EXCEPTION 'Venda não encontrada ou já cancelada.'; END IF;
  IF v.status='concluida' AND m.papel='operadora' THEN RAISE EXCEPTION 'Só a supervisora cancela venda concluída.'; END IF;
  IF EXISTS(select 1 from pdv_caixas where id=v.caixa_id and status='fechado') THEN RAISE EXCEPTION 'O caixa desta venda já foi fechado.'; END IF;
  IF nullif(trim(coalesce(_motivo,'')),'') IS NULL THEN RAISE EXCEPTION 'Escreva o motivo do cancelamento.'; END IF;
  IF v.pix_charge_id IS NOT NULL AND coalesce(public.fin_installment_saldo(v.installment_id),1) <= 0 THEN RAISE EXCEPTION 'O Pix já foi pago. Cancelamento exige estorno pelo financeiro.'; END IF;
  SELECT * INTO u FROM pdv_unidades WHERE id=v.unidade_id;
  SELECT user_id INTO uid FROM pdv_membros WHERE id=m.id;
  FOR it IN SELECT variant_id, qtd FROM pdv_venda_itens WHERE venda_id=v.id LOOP
    saldo := public.apply_stock_delta(it.variant_id, u.location_id, it.qtd);
    INSERT INTO stock_movements(kind,variant_id,to_location_id,quantity,reason_code,reference,note,balance_after,created_by,idempotency_key,balance_to_after,balance_to_before)
    VALUES ('entrada',it.variant_id,u.location_id,it.qtd,'devolucao_cliente','PDV-'||v.codigo,'Cancelamento venda PDV: '||trim(_motivo),saldo,uid,'pdv-cancel:'||v.id||':'||it.variant_id||':'||gen_random_uuid(),saldo,saldo-it.qtd);
  END LOOP;
  UPDATE pdv_pagamentos SET status='cancelado' WHERE venda_id=v.id;
  UPDATE pdv_vendas SET status='cancelada', cancel_motivo=trim(_motivo), cancelada_por=m.id WHERE id=v.id;
END $$;

CREATE OR REPLACE FUNCTION public.pdv_comprovante(_token_hash text, _venda uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; v pdv_vendas; u pdv_unidades;
BEGIN
  s := public.pdv_sessao(_token_hash);
  SELECT * INTO v FROM pdv_vendas WHERE id=_venda AND unidade_id=s.unidade_id;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  SELECT * INTO u FROM pdv_unidades WHERE id=v.unidade_id;
  RETURN jsonb_build_object('codigo',v.codigo,'loja',u.nome,'numero_loja',u.numero,'data',v.created_at,'status',v.status,
    'vendedora',(select public.pdv_nome_usuario(user_id) from pdv_membros where id=v.membro_id),
    'cliente',v.cliente_nome,'telefone',v.cliente_telefone,'subtotal',v.subtotal_cents,'desconto',v.desconto_cents,'total',v.total_cents,'rodape',u.texto_comprovante,
    'itens',(select jsonb_agg(jsonb_build_object('nome',nome,'sku',sku,'qtd',qtd,'preco',preco_unit_cents,'total',total_cents)) from pdv_venda_itens where venda_id=v.id),
    'pagamentos',(select jsonb_agg(jsonb_build_object('forma',p.forma,'valor',p.valor_cents,'troco',p.troco_cents,'parcelas',p.parcelas,'status',p.status,'maquininha',mq.nome)) from pdv_pagamentos p left join pdv_maquininhas mq on mq.id=p.maquininha_id where p.venda_id=v.id));
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['pdv_sessao(text)','pdv_entrar(text,text,text,text)','pdv_sair(text)','pdv_operadora(text,uuid,text)','pdv_operadora_sair(text)','pdv_estado(text)','pdv_exigir_operadora(pdv_sessoes)','pdv_caixa_abrir(text,bigint)','pdv_caixa_mov(text,text,bigint,text)','pdv_caixa_fechar(text,bigint,text)','pdv_produto_buscar(text,text)','pdv_venda_concluir(text,jsonb)','pdv_pix_titulo(text,uuid)','pdv_asaas_preparar(uuid,jsonb)','pdv_pix_registrar(text,uuid,uuid,text)','pdv_pix_situacao(text,uuid)','pdv_venda_cancelar(text,uuid,text)','pdv_comprovante(text,uuid)','pdv_caixa_esperado(uuid)','pdv_preco(uuid)','pdv_nome_usuario(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;