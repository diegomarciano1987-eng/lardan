-- ===== 5) Endereço da vitrine: nunca repetido nem reservado =====
CREATE TABLE IF NOT EXISTS public.showcase_slug_history (
  slug text PRIMARY KEY,
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.showcase_slug_history TO authenticated;
GRANT ALL ON public.showcase_slug_history TO service_role;
ALTER TABLE public.showcase_slug_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "historico_slug_dono" ON public.showcase_slug_history FOR SELECT TO authenticated
  USING (party_id = public.my_party_id() OR public.is_staff(auth.uid()));

-- endereços antigos já publicados continuam presos à consultora dona
INSERT INTO public.showcase_slug_history (slug, party_id)
SELECT DISTINCT v.design->>'slug', v.party_id FROM public.showcase_design_versions v
WHERE coalesce(v.design->>'slug','') <> ''
ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.showcase_slug_history (slug, party_id)
SELECT slug, party_id FROM public.consultant_showcases ON CONFLICT (slug) DO NOTHING;

CREATE OR REPLACE FUNCTION public.showcase_slug_history_track()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.slug IS NOT NULL THEN
    INSERT INTO public.showcase_slug_history (slug, party_id) VALUES (NEW.slug, NEW.party_id)
    ON CONFLICT (slug) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_showcase_slug_history ON public.consultant_showcases;
CREATE TRIGGER trg_showcase_slug_history AFTER INSERT OR UPDATE OF slug ON public.consultant_showcases
FOR EACH ROW EXECUTE FUNCTION public.showcase_slug_history_track();

-- Lista ampliada: todas as páginas do site, categorias, coleções, páginas e
-- endereços antigos de outra consultora. Usada também pela publicação.
CREATE OR REPLACE FUNCTION public.showcase_slug_reserved(_slug text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lower(_slug) = ANY (ARRAY[
    'admin','api','acesso','carrinho','contato','colecoes','colares','brincos','aneis',
    'pulseiras','semijoias','produto','seja-lardan','a-lardan','consultora','consultoras','vitrine',
    'sitemap.xml','robots.txt','llms.txt','assets','static','login','sair','painel','app',
    'equipe','minha-conta','ajuda','convite','redefinir-senha','d','lovable','representante',
    'financeiro','como-comecar-a-vender-semijoias','como-vender-semijoias-pelo-whatsapp',
    'renda-extra-com-vendas','semijoias-consignadas-para-revenda','sitemap-pages.xml',
    'sitemap-products','lardan','lardan-oficial','oficial','suporte','sac','loja','indica','indicacao'])
  OR EXISTS (SELECT 1 FROM public.categories WHERE slug = lower(_slug))
  OR EXISTS (SELECT 1 FROM public.collections WHERE slug = lower(_slug))
  OR EXISTS (SELECT 1 FROM public.pages WHERE slug = lower(_slug))
  OR EXISTS (SELECT 1 FROM public.showcase_slug_history h
             WHERE h.slug = lower(_slug) AND h.party_id IS DISTINCT FROM public.my_party_id())
$$;
REVOKE EXECUTE ON FUNCTION public.showcase_slug_reserved(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.showcase_slug_reserved(text) TO authenticated;

-- Verificação ao digitar (estilo Instagram)
CREATE OR REPLACE FUNCTION public.vitrine_endereco_disponivel(_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s text := lower(btrim(coalesce(_slug,''))); eu uuid := public.my_party_id();
BEGIN
  IF eu IS NULL THEN RAISE EXCEPTION 'sem_cadastro'; END IF;
  IF length(s) < 3 THEN RETURN jsonb_build_object('disponivel',false,'motivo','curto'); END IF;
  IF length(s) > 40 OR s !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN RETURN jsonb_build_object('disponivel',false,'motivo','formato'); END IF;
  IF EXISTS (SELECT 1 FROM public.consultant_showcases WHERE slug = s AND party_id = eu) THEN
    RETURN jsonb_build_object('disponivel',true,'motivo','seu');
  END IF;
  IF EXISTS (SELECT 1 FROM public.consultant_showcases WHERE slug = s AND party_id <> eu)
     OR EXISTS (SELECT 1 FROM public.showcase_slug_history WHERE slug = s AND party_id <> eu) THEN
    RETURN jsonb_build_object('disponivel',false,'motivo','em_uso');
  END IF;
  IF public.showcase_slug_reserved(s) THEN RETURN jsonb_build_object('disponivel',false,'motivo','reservado'); END IF;
  RETURN jsonb_build_object('disponivel',true,'motivo','livre');
END $$;
REVOKE EXECUTE ON FUNCTION public.vitrine_endereco_disponivel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vitrine_endereco_disponivel(text) TO authenticated;

-- ===== 1) Link único de indicação =====
ALTER TABLE public.consultant_profiles
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE DEFAULT lower(substr(md5(gen_random_uuid()::text),1,8));
UPDATE public.consultant_profiles SET referral_code = lower(substr(md5(gen_random_uuid()::text),1,8)) WHERE referral_code IS NULL;
ALTER TABLE public.consultant_profiles ADD COLUMN IF NOT EXISTS sponsor_set_at timestamptz;
ALTER TABLE public.consultant_profiles ADD COLUMN IF NOT EXISTS sponsor_origin text;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS referred_by_party_id uuid REFERENCES public.parties(id);
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS referred_at timestamptz;
CREATE INDEX IF NOT EXISTS leads_referred_by_idx ON public.leads(referred_by_party_id);

-- nome público de quem convidou (só o primeiro nome)
CREATE OR REPLACE FUNCTION public.indicacao_publica(_code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('nome', split_part(coalesce(p.display_name, p.legal_name, ''), ' ', 1))
  FROM public.consultant_profiles c JOIN public.parties p ON p.id = c.party_id
  WHERE c.referral_code = lower(btrim(_code)) LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.indicacao_publica(text) TO anon, authenticated;

-- vincula a candidatura a quem indicou (a primeira indicação vale)
CREATE OR REPLACE FUNCTION public.indicacao_vincular_submissao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cod text := lower(btrim(coalesce(NEW.tracking->>'indicacao',''))); quem uuid;
BEGIN
  IF cod = '' OR NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  SELECT party_id INTO quem FROM public.consultant_profiles WHERE referral_code = cod;
  IF quem IS NULL THEN RETURN NEW; END IF;
  UPDATE public.leads SET referred_by_party_id = quem, referred_at = now()
   WHERE id = NEW.lead_id AND referred_by_party_id IS NULL AND party_id IS DISTINCT FROM quem;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_indicacao_submissao ON public.candidatura_submissions;
CREATE TRIGGER trg_indicacao_submissao AFTER INSERT ON public.candidatura_submissions
FOR EACH ROW EXECUTE FUNCTION public.indicacao_vincular_submissao();

-- quando a candidata vira consultora, a madrinha fica gravada
CREATE OR REPLACE FUNCTION public.indicacao_madrinha_do_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.party_id IS NOT NULL AND NEW.referred_by_party_id IS NOT NULL AND NEW.party_id <> NEW.referred_by_party_id THEN
    UPDATE public.consultant_profiles SET sponsor_party_id = NEW.referred_by_party_id, sponsor_set_at = now(), sponsor_origin = 'link'
     WHERE party_id = NEW.party_id AND sponsor_party_id IS NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_indicacao_lead ON public.leads;
CREATE TRIGGER trg_indicacao_lead AFTER INSERT OR UPDATE OF party_id, referred_by_party_id ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.indicacao_madrinha_do_lead();

CREATE OR REPLACE FUNCTION public.indicacao_madrinha_no_perfil()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE quem uuid;
BEGIN
  IF NEW.sponsor_party_id IS NULL THEN
    SELECT referred_by_party_id INTO quem FROM public.leads
     WHERE party_id = NEW.party_id AND referred_by_party_id IS NOT NULL AND referred_by_party_id <> NEW.party_id
     ORDER BY created_at LIMIT 1;
    IF quem IS NOT NULL THEN NEW.sponsor_party_id := quem; NEW.sponsor_set_at := now(); NEW.sponsor_origin := 'link'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_indicacao_perfil ON public.consultant_profiles;
CREATE TRIGGER trg_indicacao_perfil BEFORE INSERT ON public.consultant_profiles
FOR EACH ROW EXECUTE FUNCTION public.indicacao_madrinha_no_perfil();

-- ===== 2) Configuração =====
CREATE TABLE IF NOT EXISTS public.referral_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ativo boolean NOT NULL DEFAULT true,
  observacao text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE ON public.referral_settings TO authenticated;
GRANT ALL ON public.referral_settings TO service_role;
ALTER TABLE public.referral_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ref_settings_ler" ON public.referral_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "ref_settings_gerir" ON public.referral_settings FOR ALL TO authenticated
  USING (public.can_manage_leads(auth.uid())) WITH CHECK (public.can_manage_leads(auth.uid()));
INSERT INTO public.referral_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.referral_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_indicadas int NOT NULL CHECK (min_indicadas >= 1),
  percentual numeric(5,2) NOT NULL CHECK (percentual >= 0 AND percentual <= 50),
  titulo text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (min_indicadas)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.referral_tiers TO authenticated;
GRANT ALL ON public.referral_tiers TO service_role;
ALTER TABLE public.referral_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ref_tiers_ler" ON public.referral_tiers FOR SELECT TO authenticated USING (true);
CREATE POLICY "ref_tiers_gerir" ON public.referral_tiers FOR ALL TO authenticated
  USING (public.can_manage_leads(auth.uid())) WITH CHECK (public.can_manage_leads(auth.uid()));
INSERT INTO public.referral_tiers (min_indicadas, percentual, titulo) VALUES
  (1, 5, 'Madrinha'), (10, 7, 'Madrinha ouro'), (20, 10, 'Líder de equipe')
ON CONFLICT (min_indicadas) DO NOTHING;

-- ===== 3/4) Comissão apurada no encerramento da maleta =====
CREATE TABLE IF NOT EXISTS public.referral_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL UNIQUE REFERENCES public.kit_cycles(id),
  indicada_party_id uuid NOT NULL REFERENCES public.parties(id),
  sponsor_party_id uuid NOT NULL REFERENCES public.parties(id),
  venda_cents bigint NOT NULL,
  pecas_vendidas int NOT NULL,
  indicadas_aprovadas int NOT NULL,
  percentual numeric(5,2) NOT NULL,
  faixa text NOT NULL,
  comissao_cents bigint NOT NULL,
  itens jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'apurada' CHECK (status IN ('apurada','paga','cancelada')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.referral_commissions TO authenticated;
GRANT ALL ON public.referral_commissions TO service_role;
ALTER TABLE public.referral_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ref_com_ler" ON public.referral_commissions FOR SELECT TO authenticated
  USING (sponsor_party_id = public.my_party_id() OR public.can_manage_leads(auth.uid()) OR public.has_role(auth.uid(),'financeiro'));

CREATE OR REPLACE FUNCTION public.indicacao_aprovadas(_sponsor uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(DISTINCT x)::int FROM (
    SELECT party_id x FROM public.consultant_profiles WHERE sponsor_party_id = _sponsor
    UNION SELECT coalesce(party_id, id) FROM public.leads WHERE referred_by_party_id = _sponsor AND outcome = 'ganha'
  ) t
$$;
REVOKE EXECUTE ON FUNCTION public.indicacao_aprovadas(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.indicacao_apurar_maleta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE madrinha uuid; n int; fx record; venda bigint; pecas int; itens jsonb; ativo boolean;
BEGIN
  IF NEW.status <> 'encerrada' OR OLD.status = 'encerrada' THEN RETURN NEW; END IF;
  SELECT r.ativo INTO ativo FROM public.referral_settings r WHERE id = 1;
  IF NOT coalesce(ativo, false) THEN RETURN NEW; END IF;
  SELECT sponsor_party_id INTO madrinha FROM public.consultant_profiles WHERE party_id = NEW.consultora_party_id;
  IF madrinha IS NULL OR madrinha = NEW.consultora_party_id THEN RETURN NEW; END IF;
  n := public.indicacao_aprovadas(madrinha);
  SELECT * INTO fx FROM public.referral_tiers WHERE min_indicadas <= n ORDER BY min_indicadas DESC LIMIT 1;
  IF fx IS NULL THEN RETURN NEW; END IF;

  WITH preco AS (
    SELECT DISTINCT ON (mi.variant_id) mi.variant_id, mi.unit_reference_cents
    FROM public.kit_movement_items mi JOIN public.kit_movements m ON m.id = mi.movement_id
    WHERE m.cycle_id = NEW.id AND mi.unit_reference_cents IS NOT NULL
    ORDER BY mi.variant_id, m.created_at DESC
  ), l AS (
    SELECT b.variant_id, b.qty_sold, coalesce(p.unit_reference_cents,0)::bigint preco,
           coalesce(pr.name,'Peça') produto
    FROM public.kit_balances b LEFT JOIN preco p ON p.variant_id = b.variant_id
    LEFT JOIN public.product_variants v ON v.id = b.variant_id LEFT JOIN public.products pr ON pr.id = v.product_id
    WHERE b.cycle_id = NEW.id AND b.qty_sold > 0
  )
  SELECT coalesce(sum(qty_sold*preco),0), coalesce(sum(qty_sold),0),
         coalesce(jsonb_agg(jsonb_build_object('produto',produto,'qtd',qty_sold,'preco_cents',preco,'total_cents',qty_sold*preco)),'[]')
    INTO venda, pecas, itens FROM l;

  INSERT INTO public.referral_commissions (cycle_id, indicada_party_id, sponsor_party_id, venda_cents, pecas_vendidas,
    indicadas_aprovadas, percentual, faixa, comissao_cents, itens)
  VALUES (NEW.id, NEW.consultora_party_id, madrinha, venda, pecas, n, fx.percentual, fx.titulo,
          round(venda * fx.percentual / 100.0)::bigint, itens)
  ON CONFLICT (cycle_id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_indicacao_apurar ON public.kit_cycles;
CREATE TRIGGER zz_indicacao_apurar AFTER UPDATE OF status ON public.kit_cycles
FOR EACH ROW EXECUTE FUNCTION public.indicacao_apurar_maleta();

-- painel da consultora
CREATE OR REPLACE FUNCTION public.minhas_indicacoes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.my_party_id(); n int; fx record; prox record;
BEGIN
  IF eu IS NULL THEN RAISE EXCEPTION 'sem_cadastro'; END IF;
  n := public.indicacao_aprovadas(eu);
  SELECT * INTO fx FROM public.referral_tiers WHERE min_indicadas <= n ORDER BY min_indicadas DESC LIMIT 1;
  SELECT * INTO prox FROM public.referral_tiers WHERE min_indicadas > n ORDER BY min_indicadas LIMIT 1;
  RETURN jsonb_build_object(
    'codigo', (SELECT referral_code FROM public.consultant_profiles WHERE party_id = eu),
    'ativo', (SELECT ativo FROM public.referral_settings WHERE id = 1),
    'aprovadas', n,
    'faixa', CASE WHEN fx IS NULL THEN NULL ELSE jsonb_build_object('titulo',fx.titulo,'percentual',fx.percentual) END,
    'proxima', CASE WHEN prox IS NULL THEN NULL ELSE jsonb_build_object('titulo',prox.titulo,'percentual',prox.percentual,'faltam',prox.min_indicadas-n) END,
    'faixas', (SELECT coalesce(jsonb_agg(jsonb_build_object('min',min_indicadas,'percentual',percentual,'titulo',titulo) ORDER BY min_indicadas),'[]') FROM public.referral_tiers),
    'indicadas', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'nome', trim(coalesce(l.first_name, split_part(l.full_name,' ',1)) || ' ' || left(coalesce(l.last_name,''),1) || CASE WHEN coalesce(l.last_name,'')<>'' THEN '.' ELSE '' END),
        'cidade', l.city, 'uf', l.uf, 'em', l.created_at,
        'situacao', CASE WHEN l.outcome='ganha' THEN 'aprovada' WHEN l.outcome='perdida' THEN 'nao_seguiu' ELSE 'em_analise' END)
        ORDER BY l.created_at DESC),'[]') FROM public.leads l WHERE l.referred_by_party_id = eu),
    'comissoes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'em', c.created_at, 'indicada', split_part(coalesce(p.display_name,p.legal_name,''),' ',1),
        'venda_cents', c.venda_cents, 'pecas', c.pecas_vendidas, 'percentual', c.percentual, 'faixa', c.faixa,
        'comissao_cents', c.comissao_cents, 'status', c.status, 'itens', c.itens) ORDER BY c.created_at DESC),'[]')
      FROM public.referral_commissions c JOIN public.parties p ON p.id = c.indicada_party_id WHERE c.sponsor_party_id = eu)
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.minhas_indicacoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minhas_indicacoes() TO authenticated;

-- painel administrativo
CREATE OR REPLACE FUNCTION public.indicacao_painel_admin()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.can_manage_leads(auth.uid()) OR public.has_role(auth.uid(),'financeiro')) THEN RAISE EXCEPTION 'sem_permissao'; END IF;
  RETURN jsonb_build_object(
    'rede', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'party_id', c.party_id, 'nome', coalesce(p.display_name,p.legal_name), 'codigo', c.referral_code,
        'aprovadas', public.indicacao_aprovadas(c.party_id),
        'candidaturas', (SELECT count(*) FROM public.leads l WHERE l.referred_by_party_id = c.party_id),
        'madrinha', (SELECT coalesce(s.display_name,s.legal_name) FROM public.parties s WHERE s.id = c.sponsor_party_id),
        'comissao_cents', (SELECT coalesce(sum(comissao_cents),0) FROM public.referral_commissions r WHERE r.sponsor_party_id = c.party_id AND r.status <> 'cancelada'))
        ORDER BY coalesce(p.display_name,p.legal_name)),'[]')
      FROM public.consultant_profiles c JOIN public.parties p ON p.id = c.party_id),
    'comissoes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'em', r.created_at, 'madrinha', coalesce(s.display_name,s.legal_name), 'indicada', coalesce(i.display_name,i.legal_name),
        'venda_cents', r.venda_cents, 'pecas', r.pecas_vendidas, 'aprovadas', r.indicadas_aprovadas, 'percentual', r.percentual,
        'faixa', r.faixa, 'comissao_cents', r.comissao_cents, 'status', r.status, 'itens', r.itens) ORDER BY r.created_at DESC),'[]')
      FROM public.referral_commissions r JOIN public.parties s ON s.id = r.sponsor_party_id JOIN public.parties i ON i.id = r.indicada_party_id)
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.indicacao_painel_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.indicacao_painel_admin() TO authenticated;