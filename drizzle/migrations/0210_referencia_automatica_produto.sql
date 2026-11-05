ALTER TABLE public.product_media ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS product_media_variant_idx ON public.product_media(variant_id) WHERE variant_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.produto_ref_prefixo(_category_id uuid, _banho text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select 'L' || case c.slug
      when 'aneis' then 'AN' when 'bracelete' then 'BC' when 'brincos' then 'BR'
      when 'colares' then 'GR' when 'conjunto' then 'CJ' when 'piercing' then 'PC'
      when 'pingente' then 'PG' when 'pulseiras' then 'PU' when 'tornozeleira' then 'TN'
      when 'berloque' then 'BE' when 'broche' then 'BH' else null end
    || case _banho when 'dourado' then 'D' when 'prata_banhada' then 'P' when 'prata_925' then 'P'
      when 'rodio_branco' then 'R' when 'aco_inox' then 'A' else null end
  from categories c where c.id = _category_id
$$;

-- Próxima referência: continua a numeração do último produto criado com o mesmo prefixo,
-- pulando números já usados (nunca reaproveita referência existente).
CREATE OR REPLACE FUNCTION public.produto_referencia_sugerir(_category_id uuid, _banho text, _product_id uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare _pre text; _n int; _ref text;
begin
  if not public.has_capability(auth.uid(),'product.manage') then
    raise exception 'Sem permissão.' using errcode='42501';
  end if;
  _pre := public.produto_ref_prefixo(_category_id, _banho);
  if _pre is null then return null; end if;
  select substring(reference_code from '^' || _pre || '([0-9]{4})$')::int into _n
    from products where reference_code ~ ('^' || _pre || '[0-9]{4}$')
     and (_product_id is null or id <> _product_id)
   order by created_at desc limit 1;
  _n := coalesce(_n, 0) + 1;
  loop
    _ref := _pre || lpad(_n::text, 4, '0');
    exit when not exists (select 1 from products where upper(reference_code) = _ref)
          and not exists (select 1 from product_variants where upper(reference_code) like _ref || '%');
    _n := _n + 1;
  end loop;
  return _ref;
end $$;
REVOKE ALL ON FUNCTION public.produto_referencia_sugerir(uuid,text,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.produto_referencia_sugerir(uuid,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.produto_ref_prefixo(uuid,text) FROM public, anon;

-- Referência da variante: referência do produto + próxima letra livre (A, B, C...).
CREATE OR REPLACE FUNCTION public.variante_referencia_sugerir(_product_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare _base text; _i int := 0; _ref text;
begin
  if not public.has_capability(auth.uid(),'product.manage') then
    raise exception 'Sem permissão.' using errcode='42501';
  end if;
  select upper(btrim(reference_code)) into _base from products where id = _product_id;
  if coalesce(_base,'') = '' then return null; end if;
  loop
    _ref := _base || chr(65 + _i);
    exit when not exists (select 1 from product_variants where upper(reference_code) = _ref);
    _i := _i + 1;
    if _i > 25 then return null; end if;
  end loop;
  return _ref;
end $$;
REVOKE ALL ON FUNCTION public.variante_referencia_sugerir(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.variante_referencia_sugerir(uuid) TO authenticated;

-- NCM padrão de semijoias quando vier vazio.
CREATE OR REPLACE FUNCTION public.products_ncm_padrao() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
begin
  if coalesce(new.ncm,'') = '' then new.ncm := '71171900'; end if;
  return new;
end $$;
DROP TRIGGER IF EXISTS trg_products_ncm_padrao ON public.products;
CREATE TRIGGER trg_products_ncm_padrao BEFORE INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.products_ncm_padrao();