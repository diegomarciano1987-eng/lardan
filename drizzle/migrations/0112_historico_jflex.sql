CREATE TABLE IF NOT EXISTS public.legado_importacoes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tipo text NOT NULL,lote text NOT NULL,linhas int NOT NULL,ator_id uuid,created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.legado_importacoes TO service_role;
ALTER TABLE public.legado_importacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_importacoes FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS public.legado_pracas (codigo int PRIMARY KEY,nome text NOT NULL,dias int,cidades text,praca_id uuid REFERENCES public.cob_pracas(id),atualizado_em timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.legado_pracas TO service_role;
ALTER TABLE public.legado_pracas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_pracas FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS public.legado_representantes (codigo int PRIMARY KEY,nome text,cpf text,ativo boolean,comissao_pct numeric(6,2),pracas int[],party_id uuid REFERENCES public.parties(id),vinculo text,atualizado_em timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.legado_representantes TO service_role;
ALTER TABLE public.legado_representantes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_representantes FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS public.legado_consultoras (codcli int PRIMARY KEY,nome text,apelido text,cpf text,nascimento date,sexo text,celular text,telefone text,email text,rua text,numero text,bairro text,cep text,complemento text,cidade text,uf text,ibge text,praca int,representante int,ativo boolean,motivo_inativacao text,cadastro_em date,asaas_id text,limite_venda numeric(14,2),party_id uuid REFERENCES public.parties(id),vinculo text CHECK(vinculo IS NULL OR vinculo IN ('codigo','cpf','manual')),vinculado_em timestamptz,atualizado_em timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.legado_consultoras TO service_role;
ALTER TABLE public.legado_consultoras ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_consultoras FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS legado_consultoras_party_idx ON public.legado_consultoras(party_id);
CREATE INDEX IF NOT EXISTS legado_consultoras_cpf_idx ON public.legado_consultoras(cpf);
CREATE TABLE IF NOT EXISTS public.legado_produtos (codigo int PRIMARY KEY,nome text,referencia text,codigo_barras text,categoria text,subcategoria text,ativo boolean,cadastro_em date,preco_venda_cents bigint,product_id uuid REFERENCES public.products(id),variant_id uuid REFERENCES public.product_variants(id),atualizado_em timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.legado_produtos TO service_role;
ALTER TABLE public.legado_produtos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_produtos FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS public.legado_remessas (numero int PRIMARY KEY,emissao date,vencimento date,status text NOT NULL CHECK(status IN ('aberta','fechada')),praca int,representante int,atualizado_em timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.legado_remessas TO service_role;
ALTER TABLE public.legado_remessas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_remessas FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS public.legado_maletas (remessa int NOT NULL,codcli int NOT NULL,kit int NOT NULL,tipo text NOT NULL DEFAULT 'remessa' CHECK(tipo IN ('remessa','perdida')),emissao date,fechamento date,pecas_enviadas int NOT NULL DEFAULT 0,pecas_devolvidas int NOT NULL DEFAULT 0,pecas_defeito int NOT NULL DEFAULT 0,valor_enviado_cents bigint NOT NULL DEFAULT 0,valor_devolvido_cents bigint NOT NULL DEFAULT 0,pecas_vendidas int GENERATED ALWAYS AS (pecas_enviadas - pecas_devolvidas) STORED,valor_vendido_cents bigint GENERATED ALWAYS AS (valor_enviado_cents - valor_devolvido_cents) STORED,nf_remessa text,nf_devolucao text,nf_venda text,nf_perda text,atualizado_em timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(remessa,codcli,kit));
GRANT ALL ON public.legado_maletas TO service_role;
ALTER TABLE public.legado_maletas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_maletas FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS legado_maletas_codcli_idx ON public.legado_maletas(codcli);
CREATE TABLE IF NOT EXISTS public.legado_maleta_categorias (remessa int NOT NULL,codcli int NOT NULL,kit int NOT NULL,categoria text NOT NULL,pecas_enviadas int NOT NULL DEFAULT 0,pecas_devolvidas int NOT NULL DEFAULT 0,valor_enviado_cents bigint NOT NULL DEFAULT 0,valor_devolvido_cents bigint NOT NULL DEFAULT 0,PRIMARY KEY(remessa,codcli,kit,categoria));
GRANT ALL ON public.legado_maleta_categorias TO service_role;
ALTER TABLE public.legado_maleta_categorias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_maleta_categorias FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS legado_maleta_categorias_codcli_idx ON public.legado_maleta_categorias(codcli);
CREATE TABLE IF NOT EXISTS public.legado_maleta_vendidos (remessa int NOT NULL,codcli int NOT NULL,kit int NOT NULL,produto int NOT NULL,tamanho text NOT NULL DEFAULT '',quantidade int NOT NULL CHECK(quantidade>0),valor_unitario_cents bigint NOT NULL DEFAULT 0,PRIMARY KEY(remessa,codcli,kit,produto,tamanho));
GRANT ALL ON public.legado_maleta_vendidos TO service_role;
ALTER TABLE public.legado_maleta_vendidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_maleta_vendidos FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS legado_maleta_vendidos_codcli_idx ON public.legado_maleta_vendidos(codcli);
CREATE INDEX IF NOT EXISTS legado_maleta_vendidos_produto_idx ON public.legado_maleta_vendidos(produto);
CREATE TABLE IF NOT EXISTS public.legado_notas (nf_id int PRIMARY KEY,numero int NOT NULL,serie int NOT NULL,chave text,emitida_em timestamp,natureza text,tipo text CHECK(tipo IS NULL OR tipo IN ('R','D','V','P')),codcli int,remessa int,kit int,valor_cents bigint NOT NULL DEFAULT 0,pecas int,cfop text,situacao text CHECK(situacao IN ('autorizada','cancelada','inutilizada','sem_retorno')),operacao text CHECK(operacao IN ('entrada','saida')));
GRANT ALL ON public.legado_notas TO service_role;
ALTER TABLE public.legado_notas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_notas FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS legado_notas_codcli_idx ON public.legado_notas(codcli);
CREATE INDEX IF NOT EXISTS legado_notas_maleta_idx ON public.legado_notas(remessa,codcli,kit);
CREATE INDEX IF NOT EXISTS legado_notas_numero_idx ON public.legado_notas(serie,numero);
CREATE TABLE IF NOT EXISTS public.legado_acertos_praca (codigo int PRIMARY KEY,representante int,praca int,data date,status text,total_remessa_cents bigint,total_venda_cents bigint,consultoras_venda int,total_fiado_cents bigint,consultoras_fiado int,total_desconto_cents bigint,comissao_pct numeric(6,2),dinheiro_cents bigint,cheque_cents bigint,boleto_cents bigint,cartao_cents bigint,deposito_cents bigint,encerrado_em timestamp);
GRANT ALL ON public.legado_acertos_praca TO service_role;
ALTER TABLE public.legado_acertos_praca ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_acertos_praca FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS public.fiscal_roteiro_referencia (operacao text PRIMARY KEY,natureza text NOT NULL,cfop_interno text NOT NULL,cfop_interestadual text,tipo_documento text NOT NULL CHECK(tipo_documento IN ('saida','entrada')),finalidade text NOT NULL,referencia_obrigatoria boolean NOT NULL DEFAULT false,csosn text,pis_cst text,cofins_cst text,ncm_padrao text,origem text,unidade text,mod_frete text,valor_base text,texto_complementar text,fonte text NOT NULL,observacao text);
GRANT ALL ON public.fiscal_roteiro_referencia TO service_role;
ALTER TABLE public.fiscal_roteiro_referencia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiscal_roteiro_referencia FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.legado_pode_ver(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND (
    public.has_any_role(_uid, ARRAY['master','diretoria','financeiro','cobranca','estoque','montagem']::public.app_role[])
    OR public.can_manage_kits(_uid) OR public.has_capability(_uid, 'registry.view'))
$$;
REVOKE ALL ON FUNCTION public.legado_pode_ver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_pode_ver(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.legado_exigir_importador()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(auth.role(),'') = 'service_role' AND auth.uid() IS NULL THEN RETURN; END IF;
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN
    RAISE EXCEPTION 'Só o Master importa o histórico do JFLEX.' USING errcode = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.legado_exigir_importador() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.legado_importar(_tipo text, _lote text, _linhas jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE n int;
BEGIN
  PERFORM public.legado_exigir_importador();
  IF jsonb_typeof(_linhas) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Envie uma lista de linhas.'; END IF;
  n := jsonb_array_length(_linhas);
  IF n = 0 THEN RETURN jsonb_build_object('tipo', _tipo, 'linhas', 0); END IF;
  IF n > 2000 THEN RAISE EXCEPTION 'Máximo de 2.000 linhas por envio.'; END IF;
  IF length(coalesce(_lote,'')) < 4 THEN RAISE EXCEPTION 'Informe o lote.'; END IF;
  CASE _tipo
  WHEN 'pracas' THEN
    INSERT INTO legado_pracas AS t (codigo, nome, dias, cidades)
    SELECT x.codigo::int, btrim(x.nome), nullif(x.dias,'')::numeric::int, nullif(x.cidades,'')
      FROM jsonb_to_recordset(_linhas) x(codigo text, nome text, dias text, cidades text)
    ON CONFLICT (codigo) DO UPDATE SET nome = excluded.nome, dias = excluded.dias, cidades = excluded.cidades, atualizado_em = now();
  WHEN 'representantes' THEN
    INSERT INTO legado_representantes AS t (codigo, nome, cpf, ativo, comissao_pct, pracas)
    SELECT x.codigo::int, nullif(btrim(x.nome),''), nullif(regexp_replace(coalesce(x.cpf,''),'\D','','g'),''), x.ativo IN ('1','true','S'),
           nullif(x.comissao_pct,'')::numeric,
           CASE WHEN coalesce(x.pracas,'') = '' THEN NULL ELSE string_to_array(x.pracas,'|')::int[] END
      FROM jsonb_to_recordset(_linhas) x(codigo text, nome text, cpf text, ativo text, comissao_pct text, pracas text)
    ON CONFLICT (codigo) DO UPDATE SET nome = excluded.nome, cpf = excluded.cpf, ativo = excluded.ativo,
      comissao_pct = excluded.comissao_pct, pracas = excluded.pracas, atualizado_em = now();
  WHEN 'consultoras' THEN
    INSERT INTO legado_consultoras AS t (codcli, nome, apelido, cpf, nascimento, sexo, celular, telefone, email, rua, numero, bairro, cep,
      complemento, cidade, uf, ibge, praca, representante, ativo, motivo_inativacao, cadastro_em, asaas_id, limite_venda)
    SELECT x.codcli::int, nullif(btrim(x.nome),''), nullif(btrim(x.apelido),''), nullif(regexp_replace(coalesce(x.cpf,''),'\D','','g'),''),
           nullif(x.nascimento,'')::date, nullif(x.sexo,''), nullif(x.celular,''), nullif(x.telefone,''), nullif(lower(btrim(x.email)),''),
           nullif(x.rua,''), nullif(x.numero,''), nullif(x.bairro,''), nullif(x.cep,''), nullif(x.complemento,''),
           nullif(x.cidade,''), nullif(upper(x.uf),''), nullif(x.ibge,''), nullif(x.praca,'')::int, nullif(x.representante,'')::int,
           x.ativo IN ('1','true','S'), nullif(x.motivo_inativacao,''), nullif(x.cadastro_em,'')::date, nullif(x.asaas_id,''),
           nullif(x.limite_venda,'')::numeric
      FROM jsonb_to_recordset(_linhas) x(codcli text, nome text, apelido text, cpf text, nascimento text, sexo text, celular text,
           telefone text, email text, rua text, numero text, bairro text, cep text, complemento text, cidade text, uf text, ibge text,
           praca text, representante text, ativo text, motivo_inativacao text, cadastro_em text, asaas_id text, limite_venda text)
    ON CONFLICT (codcli) DO UPDATE SET nome = excluded.nome, apelido = excluded.apelido, cpf = excluded.cpf, nascimento = excluded.nascimento,
      sexo = excluded.sexo, celular = excluded.celular, telefone = excluded.telefone, email = excluded.email, rua = excluded.rua,
      numero = excluded.numero, bairro = excluded.bairro, cep = excluded.cep, complemento = excluded.complemento, cidade = excluded.cidade,
      uf = excluded.uf, ibge = excluded.ibge, praca = excluded.praca, representante = excluded.representante, ativo = excluded.ativo,
      motivo_inativacao = excluded.motivo_inativacao, cadastro_em = excluded.cadastro_em, asaas_id = excluded.asaas_id,
      limite_venda = excluded.limite_venda, atualizado_em = now();
  WHEN 'produtos' THEN
    INSERT INTO legado_produtos AS t (codigo, nome, referencia, codigo_barras, categoria, subcategoria, ativo, cadastro_em, preco_venda_cents)
    SELECT x.codigo::int, nullif(btrim(x.nome),''), nullif(btrim(x.referencia),''), nullif(btrim(x.codigo_barras),''),
           nullif(btrim(x.categoria),''), nullif(btrim(x.subcategoria),''), x.ativo IN ('1','true','S'), nullif(x.cadastro_em,'')::date,
           round(nullif(x.preco_venda,'')::numeric * 100)::bigint
      FROM jsonb_to_recordset(_linhas) x(codigo text, nome text, referencia text, codigo_barras text, categoria text, subcategoria text,
           ativo text, cadastro_em text, preco_venda text)
    ON CONFLICT (codigo) DO UPDATE SET nome = excluded.nome, referencia = excluded.referencia, codigo_barras = excluded.codigo_barras,
      categoria = excluded.categoria, subcategoria = excluded.subcategoria, ativo = excluded.ativo, cadastro_em = excluded.cadastro_em,
      preco_venda_cents = excluded.preco_venda_cents, atualizado_em = now();
  WHEN 'remessas' THEN
    INSERT INTO legado_remessas AS t (numero, emissao, vencimento, status, praca, representante)
    SELECT x.numero::int, nullif(x.emissao,'')::date, nullif(x.vencimento,'')::date, x.status, nullif(x.praca,'')::int, nullif(x.representante,'')::int
      FROM jsonb_to_recordset(_linhas) x(numero text, emissao text, vencimento text, status text, praca text, representante text)
    ON CONFLICT (numero) DO UPDATE SET emissao = excluded.emissao, vencimento = excluded.vencimento, status = excluded.status,
      praca = excluded.praca, representante = excluded.representante, atualizado_em = now();
  WHEN 'maletas' THEN
    INSERT INTO legado_maletas AS t (remessa, codcli, kit, tipo, emissao, fechamento, pecas_enviadas, pecas_devolvidas, pecas_defeito,
      valor_enviado_cents, valor_devolvido_cents, nf_remessa, nf_devolucao, nf_venda, nf_perda)
    SELECT x.remessa::int, x.codcli::int, x.kit::int, coalesce(nullif(x.tipo,''),'remessa'), nullif(x.emissao,'')::date, nullif(x.fechamento,'')::date,
           coalesce(nullif(x.pecas_enviadas,'')::numeric::int,0), coalesce(nullif(x.pecas_devolvidas,'')::numeric::int,0),
           coalesce(nullif(x.pecas_defeito,'')::numeric::int,0),
           round(coalesce(nullif(x.valor_enviado,'')::numeric,0)*100)::bigint, round(coalesce(nullif(x.valor_devolvido,'')::numeric,0)*100)::bigint,
           nullif(x.nf_remessa,''), nullif(x.nf_devolucao,''), nullif(x.nf_venda,''), nullif(x.nf_perda,'')
      FROM jsonb_to_recordset(_linhas) x(remessa text, codcli text, kit text, tipo text, emissao text, fechamento text, pecas_enviadas text,
           pecas_devolvidas text, pecas_defeito text, valor_enviado text, valor_devolvido text, nf_remessa text, nf_devolucao text,
           nf_venda text, nf_perda text)
    ON CONFLICT (remessa, codcli, kit) DO UPDATE SET tipo = excluded.tipo, emissao = excluded.emissao, fechamento = excluded.fechamento,
      pecas_enviadas = excluded.pecas_enviadas, pecas_devolvidas = excluded.pecas_devolvidas, pecas_defeito = excluded.pecas_defeito,
      valor_enviado_cents = excluded.valor_enviado_cents, valor_devolvido_cents = excluded.valor_devolvido_cents,
      nf_remessa = excluded.nf_remessa, nf_devolucao = excluded.nf_devolucao, nf_venda = excluded.nf_venda, nf_perda = excluded.nf_perda,
      atualizado_em = now();
  WHEN 'maleta_categorias' THEN
    INSERT INTO legado_maleta_categorias AS t (remessa, codcli, kit, categoria, pecas_enviadas, pecas_devolvidas, valor_enviado_cents, valor_devolvido_cents)
    SELECT x.remessa::int, x.codcli::int, x.kit::int, upper(btrim(x.categoria)), coalesce(nullif(x.pecas_enviadas,'')::numeric::int,0),
           coalesce(nullif(x.pecas_devolvidas,'')::numeric::int,0), round(coalesce(nullif(x.valor_enviado,'')::numeric,0)*100)::bigint,
           round(coalesce(nullif(x.valor_devolvido,'')::numeric,0)*100)::bigint
      FROM jsonb_to_recordset(_linhas) x(remessa text, codcli text, kit text, categoria text, pecas_enviadas text, pecas_devolvidas text,
           valor_enviado text, valor_devolvido text)
    ON CONFLICT (remessa, codcli, kit, categoria) DO UPDATE SET pecas_enviadas = excluded.pecas_enviadas, pecas_devolvidas = excluded.pecas_devolvidas,
      valor_enviado_cents = excluded.valor_enviado_cents, valor_devolvido_cents = excluded.valor_devolvido_cents;
  WHEN 'maleta_vendidos' THEN
    INSERT INTO legado_maleta_vendidos AS t (remessa, codcli, kit, produto, tamanho, quantidade, valor_unitario_cents)
    SELECT x.remessa::int, x.codcli::int, x.kit::int, x.produto::int, coalesce(x.tamanho,''), x.quantidade::numeric::int,
           round(coalesce(nullif(x.valor_unitario,'')::numeric,0)*100)::bigint
      FROM jsonb_to_recordset(_linhas) x(remessa text, codcli text, kit text, produto text, tamanho text, quantidade text, valor_unitario text)
     WHERE x.quantidade::numeric > 0
    ON CONFLICT (remessa, codcli, kit, produto, tamanho) DO UPDATE SET quantidade = excluded.quantidade,
      valor_unitario_cents = excluded.valor_unitario_cents;
  WHEN 'notas' THEN
    INSERT INTO legado_notas AS t (nf_id, numero, serie, chave, emitida_em, natureza, tipo, codcli, remessa, kit, valor_cents, pecas, cfop, situacao, operacao)
    SELECT x.nf_id::int, x.numero::int, x.serie::int, nullif(x.chave,''), nullif(x.emitida_em,'')::timestamp, nullif(btrim(x.natureza),''),
           nullif(x.tipo,''), nullif(x.codcli,'')::int, nullif(x.remessa,'')::int, nullif(x.kit,'')::int,
           round(coalesce(nullif(x.valor,'')::numeric,0)*100)::bigint, nullif(x.pecas,'')::numeric::int, nullif(x.cfop,''),
           nullif(x.situacao,''), nullif(x.operacao,'')
      FROM jsonb_to_recordset(_linhas) x(nf_id text, numero text, serie text, chave text, emitida_em text, natureza text, tipo text,
           codcli text, remessa text, kit text, valor text, pecas text, cfop text, situacao text, operacao text)
    ON CONFLICT (nf_id) DO UPDATE SET numero = excluded.numero, serie = excluded.serie, chave = excluded.chave, emitida_em = excluded.emitida_em,
      natureza = excluded.natureza, tipo = excluded.tipo, codcli = excluded.codcli, remessa = excluded.remessa, kit = excluded.kit,
      valor_cents = excluded.valor_cents, pecas = excluded.pecas, cfop = excluded.cfop, situacao = excluded.situacao, operacao = excluded.operacao;
  WHEN 'acertos_praca' THEN
    INSERT INTO legado_acertos_praca AS t (codigo, representante, praca, data, status, total_remessa_cents, total_venda_cents, consultoras_venda,
      total_fiado_cents, consultoras_fiado, total_desconto_cents, comissao_pct, dinheiro_cents, cheque_cents, boleto_cents, cartao_cents,
      deposito_cents, encerrado_em)
    SELECT x.codigo::int, nullif(x.representante,'')::int, nullif(x.praca,'')::int, nullif(x.data,'')::date, nullif(x.status,''),
           round(coalesce(nullif(x.total_remessa,'')::numeric,0)*100)::bigint, round(coalesce(nullif(x.total_venda,'')::numeric,0)*100)::bigint,
           nullif(x.consultoras_venda,'')::numeric::int, round(coalesce(nullif(x.total_fiado,'')::numeric,0)*100)::bigint,
           nullif(x.consultoras_fiado,'')::numeric::int, round(coalesce(nullif(x.total_desconto,'')::numeric,0)*100)::bigint,
           nullif(x.comissao_pct,'')::numeric, round(coalesce(nullif(x.dinheiro,'')::numeric,0)*100)::bigint,
           round(coalesce(nullif(x.cheque,'')::numeric,0)*100)::bigint, round(coalesce(nullif(x.boleto,'')::numeric,0)*100)::bigint,
           round(coalesce(nullif(x.cartao,'')::numeric,0)*100)::bigint, round(coalesce(nullif(x.deposito,'')::numeric,0)*100)::bigint,
           nullif(x.encerrado_em,'')::timestamp
      FROM jsonb_to_recordset(_linhas) x(codigo text, representante text, praca text, data text, status text, total_remessa text,
           total_venda text, consultoras_venda text, total_fiado text, consultoras_fiado text, total_desconto text, comissao_pct text,
           dinheiro text, cheque text, boleto text, cartao text, deposito text, encerrado_em text)
    ON CONFLICT (codigo) DO UPDATE SET representante = excluded.representante, praca = excluded.praca, data = excluded.data,
      status = excluded.status, total_remessa_cents = excluded.total_remessa_cents, total_venda_cents = excluded.total_venda_cents,
      consultoras_venda = excluded.consultoras_venda, total_fiado_cents = excluded.total_fiado_cents,
      consultoras_fiado = excluded.consultoras_fiado, total_desconto_cents = excluded.total_desconto_cents,
      comissao_pct = excluded.comissao_pct, dinheiro_cents = excluded.dinheiro_cents, cheque_cents = excluded.cheque_cents,
      boleto_cents = excluded.boleto_cents, cartao_cents = excluded.cartao_cents, deposito_cents = excluded.deposito_cents,
      encerrado_em = excluded.encerrado_em;
  ELSE
    RAISE EXCEPTION 'Tipo de arquivo desconhecido: %', _tipo;
  END CASE;
  INSERT INTO legado_importacoes (tipo, lote, linhas, ator_id) VALUES (_tipo, _lote, n, auth.uid());
  RETURN jsonb_build_object('tipo', _tipo, 'linhas', n);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_importar(text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_importar(text,text,jsonb) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.legado_vincular(_gravar_codigos boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r jsonb;
BEGIN
  PERFORM public.legado_exigir_importador();
  UPDATE legado_consultoras l SET party_id = c.party_id, vinculo = 'codigo', vinculado_em = now()
    FROM party_codigos_legados c
   WHERE c.sistema = 'cliente' AND c.codigo = l.codcli::text AND l.vinculo IS DISTINCT FROM 'manual'
     AND l.party_id IS DISTINCT FROM c.party_id;
  WITH unicos AS (
    SELECT p.doc_digits, min(p.id::text)::uuid AS party_id FROM parties p
     WHERE p.doc_digits IS NOT NULL AND length(p.doc_digits) = 11
       AND p.doc_digits IN (SELECT cpf FROM legado_consultoras WHERE party_id IS NULL)
     GROUP BY p.doc_digits HAVING count(*) = 1)
  UPDATE legado_consultoras l SET party_id = u.party_id, vinculo = 'cpf', vinculado_em = now()
    FROM unicos u WHERE l.party_id IS NULL AND l.cpf = u.doc_digits;
  IF _gravar_codigos THEN
    INSERT INTO party_codigos_legados (party_id, sistema, codigo)
    SELECT l.party_id, 'cliente', l.codcli::text FROM legado_consultoras l
     WHERE l.vinculo = 'cpf' AND l.party_id IS NOT NULL
    ON CONFLICT (sistema, codigo) DO NOTHING;
  END IF;
  WITH unicos AS (
    SELECT p.doc_digits, min(p.id::text)::uuid AS party_id FROM parties p
     WHERE p.doc_digits IN (SELECT cpf FROM legado_representantes WHERE cpf IS NOT NULL)
     GROUP BY p.doc_digits HAVING count(*) = 1)
  UPDATE legado_representantes l SET party_id = u.party_id, vinculo = 'cpf'
    FROM unicos u WHERE l.cpf = u.doc_digits AND l.party_id IS DISTINCT FROM u.party_id AND l.vinculo IS DISTINCT FROM 'manual';
  UPDATE legado_pracas l SET praca_id = c.id FROM cob_pracas c WHERE c.codigo = l.codigo AND l.praca_id IS DISTINCT FROM c.id;
  WITH cand AS (
    SELECT l.codigo, v.id AS variant_id, v.product_id
      FROM legado_produtos l
      JOIN product_variants v ON upper(v.reference_code) = upper(l.referencia) OR upper(v.legacy_code) = upper(l.referencia)
                              OR (l.codigo_barras ~ '^[0-9]{8,14}$' AND v.barcode = l.codigo_barras)
     WHERE l.referencia IS NOT NULL OR l.codigo_barras IS NOT NULL
    UNION
    SELECT l.codigo, (SELECT v.id FROM product_variants v WHERE v.product_id = p.id ORDER BY v.is_default DESC, v.position LIMIT 1), p.id
      FROM legado_produtos l
      JOIN products p ON upper(p.reference_code) = upper(l.referencia) OR upper(p.legacy_code) = upper(l.referencia)
                      OR upper(p.internal_code) = upper(l.referencia)
     WHERE l.referencia IS NOT NULL),
  unicos AS (SELECT codigo, min(variant_id::text)::uuid variant_id, min(product_id::text)::uuid product_id
               FROM cand GROUP BY codigo HAVING count(DISTINCT product_id) = 1)
  UPDATE legado_produtos l SET variant_id = u.variant_id, product_id = u.product_id
    FROM unicos u WHERE u.codigo = l.codigo AND (l.product_id IS DISTINCT FROM u.product_id);
  SELECT jsonb_build_object(
    'consultoras', jsonb_build_object(
      'total', count(*), 'por_codigo', count(*) FILTER (WHERE vinculo = 'codigo'), 'por_cpf', count(*) FILTER (WHERE vinculo = 'cpf'),
      'manual', count(*) FILTER (WHERE vinculo = 'manual'), 'sem_cadastro', count(*) FILTER (WHERE party_id IS NULL),
      'sem_cadastro_com_maleta', count(*) FILTER (WHERE party_id IS NULL AND EXISTS (SELECT 1 FROM legado_maletas m WHERE m.codcli = l.codcli)),
      'cpf_ambiguo', count(*) FILTER (WHERE party_id IS NULL AND cpf IS NOT NULL
                       AND (SELECT count(*) FROM parties p WHERE p.doc_digits = l.cpf) > 1)),
    'representantes', (SELECT jsonb_build_object('total', count(*), 'vinculados', count(party_id)) FROM legado_representantes),
    'pracas', (SELECT jsonb_build_object('total', count(*), 'vinculadas', count(praca_id)) FROM legado_pracas),
    'produtos', (SELECT jsonb_build_object('total', count(*), 'vinculados', count(product_id)) FROM legado_produtos))
  INTO r FROM legado_consultoras l;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload) VALUES (auth.uid(), 'legado.vincular', 'legado_consultoras', 'jflex', r);
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.legado_vincular(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_vincular(boolean) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.legado_consultora_vincular(_codcli int, _party uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE antes uuid;
BEGIN
  PERFORM public.legado_exigir_importador();
  SELECT party_id INTO antes FROM legado_consultoras WHERE codcli = _codcli FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consultora % não está no histórico.', _codcli; END IF;
  IF _party IS NOT NULL AND NOT EXISTS (SELECT 1 FROM parties WHERE id = _party) THEN RAISE EXCEPTION 'Pessoa inexistente.'; END IF;
  UPDATE legado_consultoras SET party_id = _party, vinculo = CASE WHEN _party IS NULL THEN NULL ELSE 'manual' END, vinculado_em = now()
   WHERE codcli = _codcli;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'legado.vinculo_manual', 'legado_consultoras', _codcli::text, jsonb_build_object('antes', antes, 'depois', _party));
  RETURN jsonb_build_object('codcli', _codcli, 'party_id', _party);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_consultora_vincular(int,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_consultora_vincular(int,uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.legado_pendencias_vinculo(_busca text DEFAULT NULL, _limite int DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  PERFORM public.legado_exigir_importador();
  RETURN coalesce((SELECT jsonb_agg(x) FROM (
    SELECT l.codcli, l.nome, l.cidade, l.uf, l.ativo,
           CASE WHEN l.cpf IS NULL THEN NULL ELSE '***.' || substr(l.cpf,4,3) || '.' || substr(l.cpf,7,3) || '-**' END AS cpf_mascarado,
           (SELECT count(*) FROM legado_maletas m WHERE m.codcli = l.codcli) AS maletas,
           (SELECT max(m.emissao) FROM legado_maletas m WHERE m.codcli = l.codcli) AS ultima_maleta,
           (SELECT count(*) FROM parties p WHERE p.doc_digits = l.cpf) AS pessoas_com_mesmo_cpf
      FROM legado_consultoras l
     WHERE l.party_id IS NULL AND EXISTS (SELECT 1 FROM legado_maletas m WHERE m.codcli = l.codcli)
       AND (_busca IS NULL OR btrim(_busca) = '' OR l.nome ILIKE '%' || btrim(_busca) || '%' OR l.codcli::text = btrim(_busca))
     ORDER BY ultima_maleta DESC NULLS LAST LIMIT least(greatest(coalesce(_limite,100),1),500)) x), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_pendencias_vinculo(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_pendencias_vinculo(text,int) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.legado_consultora_dados(_codclis int[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  WITH fech AS (
    SELECT m.* FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
     WHERE m.codcli = ANY (_codclis) AND r.status = 'fechada' AND m.fechamento IS NOT NULL AND m.tipo = 'remessa'),
  todas AS (SELECT m.* FROM legado_maletas m WHERE m.codcli = ANY (_codclis)),
  praca AS (SELECT (SELECT r.praca FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
                     WHERE m.codcli = ANY (_codclis) ORDER BY m.emissao DESC NULLS LAST LIMIT 1) AS codigo),
  cat AS (
    SELECT c.categoria, sum(c.pecas_enviadas) env, sum(c.pecas_enviadas - c.pecas_devolvidas) vend,
           sum(c.valor_enviado_cents - c.valor_devolvido_cents) valor
      FROM legado_maleta_categorias c JOIN fech f USING (remessa, codcli, kit) GROUP BY 1),
  cat_praca AS (
    SELECT c.categoria, sum(c.pecas_enviadas) env, sum(c.pecas_enviadas - c.pecas_devolvidas) vend
      FROM legado_maleta_categorias c JOIN legado_maletas m USING (remessa, codcli, kit)
      JOIN legado_remessas r ON r.numero = m.remessa
     WHERE r.status = 'fechada' AND m.fechamento IS NOT NULL AND r.praca = (SELECT codigo FROM praca) GROUP BY 1)
  SELECT jsonb_build_object(
    'codigos', to_jsonb(_codclis),
    'praca', (SELECT jsonb_build_object('codigo', p.codigo, 'nome', lp.nome) FROM praca p LEFT JOIN legado_pracas lp ON lp.codigo = p.codigo),
    'resumo', (SELECT jsonb_build_object(
        'maletas', (SELECT count(*) FROM todas), 'maletas_fechadas', count(*), 'remessas', (SELECT count(DISTINCT remessa) FROM todas),
        'primeira_maleta', (SELECT min(emissao) FROM todas), 'ultima_maleta', (SELECT max(emissao) FROM todas),
        'pecas_enviadas', coalesce(sum(pecas_enviadas),0), 'pecas_vendidas', coalesce(sum(pecas_vendidas),0),
        'giro_pct', CASE WHEN sum(pecas_enviadas) > 0 THEN round(100.0 * sum(pecas_vendidas) / sum(pecas_enviadas), 1) END,
        'valor_vendido_cents', coalesce(sum(valor_vendido_cents),0),
        'ticket_medio_maleta_cents', CASE WHEN count(*) > 0 THEN round(sum(valor_vendido_cents)::numeric / count(*)) END,
        'pecas_defeito', coalesce(sum(pecas_defeito),0),
        'maletas_perdidas', (SELECT count(*) FROM todas WHERE tipo = 'perdida'))
      FROM fech),
    'categorias', coalesce((SELECT jsonb_agg(jsonb_build_object('categoria', c.categoria, 'pecas_enviadas', c.env, 'pecas_vendidas', c.vend,
        'giro_pct', CASE WHEN c.env > 0 THEN round(100.0 * c.vend / c.env, 1) END,
        'giro_praca_pct', CASE WHEN cp.env > 0 THEN round(100.0 * cp.vend / cp.env, 1) END,
        'participacao_vendas_pct', CASE WHEN (SELECT sum(vend) FROM cat) > 0 THEN round(100.0 * c.vend / (SELECT sum(vend) FROM cat), 1) END,
        'valor_vendido_cents', c.valor) ORDER BY c.vend DESC, c.env DESC)
      FROM cat c LEFT JOIN cat_praca cp USING (categoria)), '[]'::jsonb),
    'produtos_top', coalesce((SELECT jsonb_agg(x ORDER BY x.quantidade DESC, x.valor_cents DESC) FROM (
        SELECT v.produto, p.nome, p.referencia, p.categoria, p.subcategoria, p.product_id, sum(v.quantidade) quantidade,
               sum(v.quantidade * v.valor_unitario_cents) valor_cents, max(m.emissao) ultima_venda
          FROM legado_maleta_vendidos v JOIN legado_maletas m USING (remessa, codcli, kit)
          LEFT JOIN legado_produtos p ON p.codigo = v.produto
         WHERE v.codcli = ANY (_codclis) GROUP BY 1,2,3,4,5,6 ORDER BY 7 DESC, 8 DESC LIMIT 20) x), '[]'::jsonb),
    'subcategorias_top', coalesce((SELECT jsonb_agg(x ORDER BY x.quantidade DESC) FROM (
        SELECT coalesce(p.categoria,'?') categoria, coalesce(p.subcategoria,'') subcategoria, sum(v.quantidade) quantidade
          FROM legado_maleta_vendidos v LEFT JOIN legado_produtos p ON p.codigo = v.produto
         WHERE v.codcli = ANY (_codclis) GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10) x), '[]'::jsonb),
    'por_ano', coalesce((SELECT jsonb_agg(x ORDER BY x.ano) FROM (
        SELECT extract(year FROM emissao)::int ano, count(*) maletas, sum(pecas_vendidas) pecas_vendidas, sum(valor_vendido_cents) valor_vendido_cents
          FROM fech GROUP BY 1) x), '[]'::jsonb),
    'maletas', coalesce((SELECT jsonb_agg(x ORDER BY x.emissao DESC NULLS LAST, x.remessa DESC) FROM (
        SELECT m.remessa, m.kit, m.codcli, m.tipo, m.emissao, m.fechamento, r.status status_remessa, lp.nome praca, lr.nome representante,
               m.pecas_enviadas, m.pecas_devolvidas, m.pecas_defeito, m.valor_enviado_cents,
               CASE WHEN m.fechamento IS NOT NULL THEN m.pecas_vendidas END pecas_vendidas,
               CASE WHEN m.fechamento IS NOT NULL THEN m.valor_vendido_cents END valor_vendido_cents,
               CASE WHEN m.pecas_enviadas > 0 AND m.fechamento IS NOT NULL THEN round(100.0 * m.pecas_vendidas / m.pecas_enviadas, 1) END giro_pct,
               m.nf_remessa, m.nf_devolucao, m.nf_venda, m.nf_perda
          FROM todas m LEFT JOIN legado_remessas r ON r.numero = m.remessa
          LEFT JOIN legado_pracas lp ON lp.codigo = r.praca LEFT JOIN legado_representantes lr ON lr.codigo = r.representante
         ORDER BY m.emissao DESC NULLS LAST LIMIT 300) x), '[]'::jsonb))
$fn$;
REVOKE ALL ON FUNCTION public.legado_consultora_dados(int[]) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.legado_consultora_historico(_party uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE cods int[];
BEGIN
  IF NOT public.legado_pode_ver(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para ver o histórico.' USING errcode = '42501'; END IF;
  SELECT array_agg(codcli ORDER BY codcli) INTO cods FROM legado_consultoras WHERE party_id = _party;
  IF cods IS NULL THEN RETURN jsonb_build_object('vinculada', false); END IF;
  RETURN public.legado_consultora_dados(cods) || jsonb_build_object('vinculada', true);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_consultora_historico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_consultora_historico(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.consultora_meu_historico()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE eu uuid := public.my_party_id(); cods int[]; d jsonb;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(), 'consultora') THEN
    RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode = '42501';
  END IF;
  SELECT array_agg(codcli) INTO cods FROM legado_consultoras WHERE party_id = eu;
  IF cods IS NULL THEN RETURN jsonb_build_object('vinculada', false); END IF;
  d := public.legado_consultora_dados(cods);
  RETURN jsonb_build_object('vinculada', true, 'resumo', d->'resumo', 'categorias', d->'categorias',
    'produtos_top', d->'produtos_top', 'subcategorias_top', d->'subcategorias_top', 'por_ano', d->'por_ano',
    'maletas', (SELECT coalesce(jsonb_agg(m - 'codcli' - 'representante'), '[]'::jsonb) FROM jsonb_array_elements(d->'maletas') m));
END $fn$;
REVOKE ALL ON FUNCTION public.consultora_meu_historico() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_meu_historico() TO authenticated;
CREATE OR REPLACE FUNCTION public.legado_remessas_lista(_busca text DEFAULT NULL, _praca int DEFAULT NULL, _representante int DEFAULT NULL,
  _de date DEFAULT NULL, _ate date DEFAULT NULL, _status text DEFAULT NULL, _limite int DEFAULT 100, _offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.legado_pode_ver(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM legado_remessas r
               WHERE (_praca IS NULL OR r.praca = _praca) AND (_representante IS NULL OR r.representante = _representante)
                 AND (_de IS NULL OR r.emissao >= _de) AND (_ate IS NULL OR r.emissao <= _ate) AND (_status IS NULL OR r.status = _status)
                 AND (_busca IS NULL OR btrim(_busca) = '' OR r.numero::text = btrim(_busca))),
    'itens', coalesce((SELECT jsonb_agg(x ORDER BY x.numero DESC) FROM (
      SELECT r.numero, r.emissao, r.vencimento, r.status, r.praca praca_codigo, lp.nome praca, lp.praca_id, r.representante representante_codigo,
             lr.nome representante, lr.party_id representante_party_id,
             count(m.*) maletas, count(DISTINCT m.codcli) consultoras, coalesce(sum(m.pecas_enviadas),0) pecas_enviadas,
             coalesce(sum(m.pecas_vendidas) FILTER (WHERE m.fechamento IS NOT NULL),0) pecas_vendidas,
             CASE WHEN sum(m.pecas_enviadas) FILTER (WHERE m.fechamento IS NOT NULL) > 0
                  THEN round(100.0 * sum(m.pecas_vendidas) FILTER (WHERE m.fechamento IS NOT NULL) / sum(m.pecas_enviadas) FILTER (WHERE m.fechamento IS NOT NULL), 1) END giro_pct,
             coalesce(sum(m.valor_enviado_cents),0) valor_enviado_cents,
             coalesce(sum(m.valor_vendido_cents) FILTER (WHERE m.fechamento IS NOT NULL),0) valor_vendido_cents,
             count(m.*) FILTER (WHERE m.fechamento IS NULL) maletas_sem_acerto
        FROM legado_remessas r LEFT JOIN legado_maletas m ON m.remessa = r.numero
        LEFT JOIN legado_pracas lp ON lp.codigo = r.praca LEFT JOIN legado_representantes lr ON lr.codigo = r.representante
       WHERE (_praca IS NULL OR r.praca = _praca) AND (_representante IS NULL OR r.representante = _representante)
         AND (_de IS NULL OR r.emissao >= _de) AND (_ate IS NULL OR r.emissao <= _ate) AND (_status IS NULL OR r.status = _status)
         AND (_busca IS NULL OR btrim(_busca) = '' OR r.numero::text = btrim(_busca)
              OR EXISTS (SELECT 1 FROM legado_maletas mm JOIN legado_consultoras lc ON lc.codcli = mm.codcli
                          WHERE mm.remessa = r.numero AND lc.nome ILIKE '%' || btrim(_busca) || '%'))
       GROUP BY r.numero, lp.nome, lp.praca_id, lr.nome, lr.party_id
       ORDER BY r.numero DESC LIMIT least(greatest(coalesce(_limite,100),1),500) OFFSET greatest(coalesce(_offset,0),0)) x), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.legado_remessas_lista(text,int,int,date,date,text,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_remessas_lista(text,int,int,date,date,text,int,int) TO authenticated;
CREATE OR REPLACE FUNCTION public.legado_remessa_detalhe(_numero int)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.legado_pode_ver(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN (SELECT jsonb_build_object(
    'remessa', to_jsonb(r) || jsonb_build_object('praca_nome', lp.nome, 'representante_nome', lr.nome),
    'categorias', coalesce((SELECT jsonb_agg(x ORDER BY x.pecas_enviadas DESC) FROM (
        SELECT c.categoria, sum(c.pecas_enviadas) pecas_enviadas, sum(c.pecas_enviadas - c.pecas_devolvidas) FILTER (WHERE m.fechamento IS NOT NULL) pecas_vendidas
          FROM legado_maleta_categorias c JOIN legado_maletas m USING (remessa, codcli, kit) WHERE c.remessa = r.numero GROUP BY 1) x), '[]'::jsonb),
    'maletas', coalesce((SELECT jsonb_agg(x ORDER BY x.nome, x.kit) FROM (
        SELECT m.codcli, m.kit, m.tipo, lc.nome, lc.cidade, lc.party_id, m.emissao, m.fechamento, m.pecas_enviadas, m.pecas_devolvidas,
               CASE WHEN m.fechamento IS NOT NULL THEN m.pecas_vendidas END pecas_vendidas, m.pecas_defeito, m.valor_enviado_cents,
               CASE WHEN m.fechamento IS NOT NULL THEN m.valor_vendido_cents END valor_vendido_cents,
               m.nf_remessa, m.nf_devolucao, m.nf_venda, m.nf_perda
          FROM legado_maletas m LEFT JOIN legado_consultoras lc ON lc.codcli = m.codcli WHERE m.remessa = r.numero) x), '[]'::jsonb))
    FROM legado_remessas r LEFT JOIN legado_pracas lp ON lp.codigo = r.praca LEFT JOIN legado_representantes lr ON lr.codigo = r.representante
   WHERE r.numero = _numero);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_remessa_detalhe(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_remessa_detalhe(int) TO authenticated;
CREATE OR REPLACE FUNCTION public.legado_rede_ranking(_agrupar text DEFAULT 'praca', _de date DEFAULT NULL, _ate date DEFAULT NULL,
  _praca int DEFAULT NULL, _categoria text DEFAULT NULL, _limite int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.legado_pode_ver(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  IF _agrupar NOT IN ('praca','representante','cidade','uf','consultora','categoria') THEN RAISE EXCEPTION 'Agrupamento inválido.'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.valor_vendido_cents DESC) FROM (
    WITH base AS (
      SELECT m.remessa, m.codcli, m.kit, m.emissao, r.praca, r.representante, lc.cidade, lc.uf, lc.nome, lc.party_id,
             coalesce(c.categoria, '') categoria,
             coalesce(c.pecas_enviadas, m.pecas_enviadas) env,
             coalesce(c.pecas_enviadas - c.pecas_devolvidas, m.pecas_vendidas) vend,
             coalesce(c.valor_enviado_cents - c.valor_devolvido_cents, m.valor_vendido_cents) valor
        FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
        LEFT JOIN legado_consultoras lc ON lc.codcli = m.codcli
        LEFT JOIN legado_maleta_categorias c ON (_agrupar = 'categoria' OR _categoria IS NOT NULL)
             AND c.remessa = m.remessa AND c.codcli = m.codcli AND c.kit = m.kit
       WHERE r.status = 'fechada' AND m.fechamento IS NOT NULL AND m.tipo = 'remessa'
         AND (_de IS NULL OR m.emissao >= _de) AND (_ate IS NULL OR m.emissao <= _ate)
         AND (_praca IS NULL OR r.praca = _praca) AND (_categoria IS NULL OR c.categoria = upper(_categoria)))
    SELECT CASE _agrupar WHEN 'praca' THEN b.praca::text WHEN 'representante' THEN b.representante::text WHEN 'cidade' THEN b.cidade || '/' || b.uf
                         WHEN 'uf' THEN b.uf WHEN 'consultora' THEN b.codcli::text ELSE b.categoria END chave,
           CASE _agrupar WHEN 'praca' THEN max(lp.nome) WHEN 'representante' THEN max(lr.nome) WHEN 'cidade' THEN max(b.cidade) || '/' || max(b.uf)
                         WHEN 'uf' THEN max(b.uf) WHEN 'consultora' THEN max(b.nome) ELSE max(b.categoria) END nome,
           CASE _agrupar WHEN 'consultora' THEN (array_agg(b.party_id) FILTER (WHERE b.party_id IS NOT NULL))[1] END party_id,
           count(DISTINCT (b.remessa, b.codcli, b.kit)) maletas, count(DISTINCT b.codcli) consultoras,
           sum(b.env) pecas_enviadas, sum(b.vend) pecas_vendidas,
           CASE WHEN sum(b.env) > 0 THEN round(100.0 * sum(b.vend) / sum(b.env), 1) END giro_pct,
           sum(b.valor) valor_vendido_cents,
           round(sum(b.valor)::numeric / nullif(count(DISTINCT (b.remessa, b.codcli, b.kit)),0)) ticket_medio_maleta_cents,
           max(b.emissao) ultima_maleta
      FROM base b LEFT JOIN legado_pracas lp ON lp.codigo = b.praca LEFT JOIN legado_representantes lr ON lr.codigo = b.representante
     GROUP BY 1 ORDER BY sum(b.valor) DESC LIMIT least(greatest(coalesce(_limite,50),1),500)) x), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_rede_ranking(text,date,date,int,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_rede_ranking(text,date,date,int,text,int) TO authenticated;
CREATE OR REPLACE FUNCTION public.legado_rede_mensal(_de date DEFAULT NULL, _ate date DEFAULT NULL, _praca int DEFAULT NULL, _representante int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.legado_pode_ver(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.mes) FROM (
    SELECT to_char(date_trunc('month', m.emissao), 'YYYY-MM') mes, count(*) maletas, count(DISTINCT m.codcli) consultoras,
           sum(m.pecas_enviadas) pecas_enviadas, sum(m.pecas_vendidas) FILTER (WHERE m.fechamento IS NOT NULL) pecas_vendidas,
           sum(m.valor_vendido_cents) FILTER (WHERE m.fechamento IS NOT NULL) valor_vendido_cents,
           CASE WHEN sum(m.pecas_enviadas) FILTER (WHERE m.fechamento IS NOT NULL) > 0
                THEN round(100.0 * sum(m.pecas_vendidas) FILTER (WHERE m.fechamento IS NOT NULL) / sum(m.pecas_enviadas) FILTER (WHERE m.fechamento IS NOT NULL), 1) END giro_pct
      FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
     WHERE m.tipo = 'remessa' AND (_de IS NULL OR m.emissao >= _de) AND (_ate IS NULL OR m.emissao <= _ate)
       AND (_praca IS NULL OR r.praca = _praca) AND (_representante IS NULL OR r.representante = _representante)
     GROUP BY 1) x), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_rede_mensal(date,date,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_rede_mensal(date,date,int,int) TO authenticated;
CREATE OR REPLACE FUNCTION public.montagem_sugestao(_party uuid, _total int DEFAULT 80)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE cods int[]; pc int; k numeric := 30; v_total numeric; res jsonb; conf text;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.can_manage_kits(auth.uid())
       OR public.has_any_role(auth.uid(), ARRAY['master','diretoria','estoque','montagem']::public.app_role[])) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  IF _total IS NULL OR _total < 1 OR _total > 1000 THEN RAISE EXCEPTION 'Total de peças entre 1 e 1000.'; END IF;
  SELECT array_agg(codcli) INTO cods FROM legado_consultoras WHERE party_id = _party;
  SELECT cp.codigo INTO pc FROM consultant_profiles c JOIN cob_pracas cp ON cp.id = c.praca_id WHERE c.party_id = _party;
  IF pc IS NULL AND cods IS NOT NULL THEN
    SELECT r.praca INTO pc FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
     WHERE m.codcli = ANY (cods) ORDER BY m.emissao DESC NULLS LAST LIMIT 1;
  END IF;
  WITH fech AS (
    SELECT m.remessa, m.codcli, m.kit, r.praca FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
     WHERE r.status = 'fechada' AND m.fechamento IS NOT NULL AND m.tipo = 'remessa'),
  ref AS (
    SELECT c.categoria, sum(c.pecas_enviadas) env, sum(c.pecas_enviadas - c.pecas_devolvidas) vend
      FROM legado_maleta_categorias c JOIN fech f USING (remessa, codcli, kit)
     WHERE pc IS NULL OR f.praca = pc OR NOT EXISTS (SELECT 1 FROM fech WHERE praca = pc)
     GROUP BY 1),
  minha AS (
    SELECT c.categoria, sum(c.pecas_enviadas) env, sum(c.pecas_enviadas - c.pecas_devolvidas) vend
      FROM legado_maleta_categorias c JOIN fech f USING (remessa, codcli, kit)
     WHERE c.codcli = ANY (coalesce(cods, '{}')) GROUP BY 1),
  junta AS (
    SELECT r.categoria, coalesce(m.env,0) m_env, coalesce(m.vend,0) m_vend, r.env r_env, r.vend r_vend,
           r.vend::numeric / nullif((SELECT sum(vend) FROM ref),0) r_share
      FROM ref r LEFT JOIN minha m USING (categoria)
     WHERE r.vend > 0 OR coalesce(m.vend,0) > 0),
  peso AS (
    SELECT j.*, (j.m_vend + k * coalesce(j.r_share,0)) / ((SELECT sum(m_vend) FROM junta) + k) bruto FROM junta j),
  piso AS (
    SELECT p.*, CASE WHEN coalesce(p.r_share,0) >= 0.01 THEN greatest(p.bruto, 0.02) ELSE p.bruto END ajustado FROM peso p),
  norm AS (SELECT p.*, p.ajustado / (SELECT sum(ajustado) FROM piso) frac FROM piso p),
  base AS (SELECT n.*, floor(n.frac * _total)::int pecas, n.frac * _total - floor(n.frac * _total) resto FROM norm n),
  falta AS (SELECT _total - (SELECT sum(pecas) FROM base) n),
  ordem AS (SELECT b.*, row_number() OVER (ORDER BY b.resto DESC, b.categoria) rk FROM base b)
  SELECT jsonb_agg(jsonb_build_object(
           'categoria', o.categoria,
           'pecas_sugeridas', o.pecas + CASE WHEN o.rk <= (SELECT n FROM falta) THEN 1 ELSE 0 END,
           'participacao_sugerida_pct', round(100 * o.frac, 1),
           'consultora_pecas_vendidas', o.m_vend, 'consultora_pecas_enviadas', o.m_env,
           'consultora_giro_pct', CASE WHEN o.m_env > 0 THEN round(100.0 * o.m_vend / o.m_env, 1) END,
           'consultora_participacao_vendas_pct', CASE WHEN (SELECT sum(m_vend) FROM junta) > 0 THEN round(100.0 * o.m_vend / (SELECT sum(m_vend) FROM junta), 1) END,
           'referencia_giro_pct', CASE WHEN o.r_env > 0 THEN round(100.0 * o.r_vend / o.r_env, 1) END,
           'referencia_participacao_vendas_pct', round(100 * coalesce(o.r_share,0), 1))
         ORDER BY o.frac DESC), (SELECT sum(m_vend) FROM junta)
    INTO res, v_total FROM ordem o;
  conf := CASE WHEN coalesce(v_total,0) >= 30 THEN 'alta' WHEN coalesce(v_total,0) >= 10 THEN 'media' ELSE 'baixa' END;
  RETURN jsonb_build_object('total_pecas', _total, 'confianca', conf, 'pecas_vendidas_historico', coalesce(v_total,0),
    'referencia', CASE WHEN pc IS NULL THEN 'rede' ELSE 'praca' END, 'praca_codigo', pc,
    'praca_nome', (SELECT nome FROM legado_pracas WHERE codigo = pc),
    'como_ler', 'Mistura o que ela vendeu com o que a praça vende; quanto mais histórico, mais pesa o dela. Só sugestão: a montagem continua manual.',
    'categorias', coalesce(res, '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.montagem_sugestao(uuid,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.montagem_sugestao(uuid,int) TO authenticated;
CREATE OR REPLACE FUNCTION public.legado_resumo()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.legado_pode_ver(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object(
    'arquivos', jsonb_build_object(
      'pracas', (SELECT count(*) FROM legado_pracas), 'representantes', (SELECT count(*) FROM legado_representantes),
      'consultoras', (SELECT count(*) FROM legado_consultoras), 'produtos', (SELECT count(*) FROM legado_produtos),
      'remessas', (SELECT count(*) FROM legado_remessas), 'maletas', (SELECT count(*) FROM legado_maletas),
      'maleta_categorias', (SELECT count(*) FROM legado_maleta_categorias), 'maleta_vendidos', (SELECT count(*) FROM legado_maleta_vendidos),
      'notas', (SELECT count(*) FROM legado_notas), 'acertos_praca', (SELECT count(*) FROM legado_acertos_praca)),
    'vinculo', jsonb_build_object(
      'consultoras_vinculadas', (SELECT count(*) FROM legado_consultoras WHERE party_id IS NOT NULL),
      'consultoras_com_maleta_sem_cadastro', (SELECT count(*) FROM legado_consultoras l WHERE party_id IS NULL
                                               AND EXISTS (SELECT 1 FROM legado_maletas m WHERE m.codcli = l.codcli))),
    'periodo', (SELECT jsonb_build_object('de', min(emissao), 'ate', max(emissao)) FROM legado_remessas),
    'numeracao', jsonb_build_object(
      'ultima_remessa_jflex', (SELECT max(numero) FROM legado_remessas),
      'ultima_remessa_lardan', (SELECT max(numero) FROM remessas),
      'proxima_remessa_lardan', greatest(coalesce((SELECT max(numero) FROM remessas), 874), coalesce((SELECT max(numero) FROM legado_remessas), 0)) + 1,
      'conflitos', coalesce((SELECT jsonb_agg(r.numero ORDER BY r.numero) FROM remessas r JOIN legado_remessas l ON l.numero = r.numero), '[]'::jsonb)),
    'fiscal', jsonb_build_object(
      'ultima_nf_por_serie', coalesce((SELECT jsonb_object_agg(serie, ultima) FROM (SELECT serie, max(numero) ultima FROM legado_notas GROUP BY serie) s), '{}'::jsonb),
      'notas_por_tipo', coalesce((SELECT jsonb_object_agg(coalesce(tipo,'?'), n) FROM (SELECT tipo, count(*) n FROM legado_notas GROUP BY tipo) s), '{}'::jsonb),
      'numeros_repetidos', (SELECT count(*) FROM (SELECT serie, numero FROM legado_notas GROUP BY 1,2 HAVING count(*) > 1) d)),
    'totais', (SELECT jsonb_build_object('pecas_enviadas', sum(m.pecas_enviadas), 'pecas_vendidas', sum(m.pecas_vendidas),
        'valor_vendido_cents', sum(m.valor_vendido_cents),
        'giro_pct', round(100.0 * sum(m.pecas_vendidas) / nullif(sum(m.pecas_enviadas),0), 1))
      FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
     WHERE r.status = 'fechada' AND m.fechamento IS NOT NULL AND m.tipo = 'remessa'));
END $fn$;
REVOKE ALL ON FUNCTION public.legado_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_resumo() TO authenticated;
CREATE OR REPLACE FUNCTION public.fiscal_roteiro_observado()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_capability(auth.uid(),'finance.view') OR public.has_role(auth.uid(),'master')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY array_position(ARRAY['remessa','devolucao','venda','perda'], f.operacao))
                     FROM fiscal_roteiro_referencia f), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_roteiro_observado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_roteiro_observado() TO authenticated;
DO $num$
DECLARE d text; n text;
  a1 text := '(SELECT coalesce(max(numero), 874) + 1 FROM remessas)';
  b1 text := 'greatest((SELECT coalesce(max(numero), 874) FROM remessas), coalesce((SELECT max(numero) FROM legado_remessas), 0)) + 1';
  a2 text := 'IF EXISTS (SELECT 1 FROM remessas WHERE numero = v_num) THEN RAISE EXCEPTION ''Já existe a remessa nº %.'', v_num; END IF;';
  b2 text := 'IF EXISTS (SELECT 1 FROM remessas WHERE numero = v_num) THEN RAISE EXCEPTION ''Já existe a remessa nº %.'', v_num; END IF;
  IF EXISTS (SELECT 1 FROM legado_remessas WHERE numero = v_num) THEN RAISE EXCEPTION ''A remessa nº % já foi usada no JFLEX.'', v_num; END IF;';
BEGIN
  d := pg_get_functiondef('public.remessa_criar(uuid,integer,date,date,uuid,uuid,text)'::regprocedure);
  IF position('legado_remessas' in d) > 0 THEN RETURN; END IF;
  IF position(a1 in d) = 0 OR position(a2 in d) = 0 THEN RAISE EXCEPTION 'Definição inesperada de remessa_criar; nada alterado.'; END IF;
  n := replace(replace(d, a1, b1), a2, b2);
  EXECUTE n;
END $num$;
COMMENT ON TABLE public.legado_maletas IS 'Histórico do JFLEX (só leitura). Valores em varejo; a nota fiscal saiu a 1/3. Venda = enviadas − devolvidas, válida só com fechamento.';