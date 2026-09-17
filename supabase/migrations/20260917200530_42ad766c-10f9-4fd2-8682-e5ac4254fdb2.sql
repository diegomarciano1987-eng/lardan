
create or replace function public.party_addresses_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_uf text; v_code text; v_city text;
begin
  NEW.postal_code := nullif(regexp_replace(coalesce(NEW.postal_code,''), '\D', '', 'g'), '');
  NEW.uf := nullif(upper(btrim(coalesce(NEW.uf,''))), '');
  NEW.ibge_city_code := nullif(regexp_replace(coalesce(NEW.ibge_city_code,''), '\D', '', 'g'), '');
  NEW.ddd := nullif(regexp_replace(coalesce(NEW.ddd,''), '\D', '', 'g'), '');

  -- UF a partir do código do município
  if NEW.uf is null and NEW.ibge_city_code is not null then
    select m.uf, m.nome into v_uf, v_city
      from public.ibge_municipios m
     where m.codigo_ibge::text = NEW.ibge_city_code
     limit 1;
    if v_uf is not null then
      NEW.uf := v_uf;
      NEW.city := coalesce(nullif(btrim(coalesce(NEW.city,'')),''), v_city);
    end if;
  end if;

  -- UF a partir do nome do município, quando houver um único município com esse nome
  if NEW.uf is null and nullif(btrim(coalesce(NEW.city,'')),'') is not null then
    select max(m.uf), max(m.codigo_ibge::text) into v_uf, v_code
      from public.ibge_municipios m
     where lower(btrim(m.nome)) = lower(btrim(NEW.city))
    having count(*) = 1;
    if v_uf is not null then
      NEW.uf := v_uf;
      NEW.ibge_city_code := coalesce(NEW.ibge_city_code, v_code);
    end if;
  end if;

  -- Código do município a partir de cidade + UF
  if NEW.ibge_city_code is null and NEW.uf is not null
     and nullif(btrim(coalesce(NEW.city,'')),'') is not null then
    select m.codigo_ibge::text into v_code
      from public.ibge_municipios m
     where m.uf = NEW.uf and lower(btrim(m.nome)) = lower(btrim(NEW.city))
     limit 1;
    NEW.ibge_city_code := coalesce(NEW.ibge_city_code, v_code);
  end if;

  NEW.updated_at := now();
  return NEW;
end
$$;

-- Corrige endereços já cadastrados (dispara o gatilho acima)
update public.party_addresses
   set updated_at = updated_at
 where uf is null or ibge_city_code is null;
