CREATE OR REPLACE FUNCTION public.pdv_produto_buscar(_token_hash text, _q text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s pdv_sessoes; loc uuid; q text := trim(coalesce(_q,'')); qn text; toks text[];
  de text := 'áàâãäéèêëíìîïóòôõöúùûüçñ'; para text := 'aaaaaeeeeiiiiooooouuuucn';
BEGIN
  s := public.pdv_sessao(_token_hash);
  SELECT location_id INTO loc FROM pdv_unidades WHERE id=s.unidade_id;
  IF length(q) < 2 THEN RETURN '[]'; END IF;
  qn := translate(lower(q), de, para);
  toks := array_remove(regexp_split_to_array(qn, '\s+'), '');
  RETURN coalesce((select jsonb_agg(x) from (
    select v.id, coalesce(v.sku, v.reference_code, p.reference_code, p.internal_code) sku,
           p.name || coalesce(' — '||nullif(v.label,''),'') nome, public.pdv_preco(v.id) preco,
           coalesce((select quantity from stock_balances b where b.variant_id=v.id and b.location_id=loc),0) saldo,
           (v.barcode=q or upper(v.sku)=upper(q) or upper(v.reference_code)=upper(q) or v.legacy_code=q
             or (upper(p.reference_code)=upper(q) and (select count(*) from product_variants v2 where v2.product_id=p.id and v2.is_active)=1)) exato,
           case when v.barcode=q or upper(coalesce(v.sku,v.reference_code,p.reference_code,''))=upper(q) then 0
                when upper(coalesce(p.reference_code,v.reference_code,v.sku,'')) like upper(q)||'%' then 1 else 2 end rk
    from product_variants v join products p on p.id=v.product_id
    where v.is_active and (
      v.barcode=q or v.legacy_code=q or p.legacy_code=q
      or not exists (select 1 from unnest(toks) t where position(t in translate(lower(
           concat_ws(' ', p.name, v.label, v.sku, v.reference_code, p.reference_code, p.internal_code)), de, para)) = 0))
    order by rk, exato desc, saldo desc, nome limit 20) x),'[]');
END $$;
REVOKE ALL ON FUNCTION public.pdv_produto_buscar(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_produto_buscar(text,text) TO service_role;