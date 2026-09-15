-- 1) Migração aditiva revendedora -> loja (mantém a linha antiga como histórico)
insert into public.party_roles (party_id, role, status, started_at, notes)
select r.party_id, 'loja'::party_role_kind, r.status, r.started_at,
       coalesce(r.notes || ' | ', '') || 'Migrado do papel legado revendedora'
from public.party_roles r
where r.role = 'revendedora'
  and not exists (select 1 from public.party_roles x where x.party_id = r.party_id and x.role = 'loja');

-- 2) Contadores incluindo Lojas
create or replace function public.registry_counts()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
DECLARE res jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.view') THEN
    RETURN '{}'::jsonb;
  END IF;
  SELECT jsonb_build_object(
    'pessoas', (SELECT count(*) FROM public.parties WHERE kind = 'pessoa'),
    'organizacoes', (SELECT count(*) FROM public.parties WHERE kind = 'organizacao'),
    'ativos', (SELECT count(*) FROM public.parties WHERE status = 'ativo'),
    'rascunhos', (SELECT count(*) FROM public.parties WHERE status = 'rascunho'),
    'incompletos', (SELECT count(*) FROM public.parties
                    WHERE display_name IS NULL OR btrim(COALESCE(display_name,'')) = ''
                       OR doc_digits IS NULL
                       OR NOT EXISTS (SELECT 1 FROM public.contact_points c WHERE c.party_id = parties.id)),
    'duplicidades', (SELECT count(*) FROM (
                       SELECT doc_digits FROM public.parties
                       WHERE doc_digits IS NOT NULL GROUP BY doc_digits HAVING count(*) > 1) x),
    'atualizados_7d', (SELECT count(*) FROM public.parties WHERE updated_at > now() - interval '7 days'),
    'consultoras', (SELECT count(*) FROM public.party_roles WHERE role = 'consultora'),
    'representantes', (SELECT count(*) FROM public.party_roles WHERE role = 'representante'),
    'revendedoras', (SELECT count(*) FROM public.party_roles WHERE role = 'revendedora'),
    'lojas', (SELECT count(*) FROM public.party_roles WHERE role = 'loja'),
    'clientes', (SELECT count(*) FROM public.party_roles WHERE role = 'cliente'),
    'colaboradores', (SELECT count(*) FROM public.party_roles WHERE role = 'colaborador'),
    'fornecedores', (SELECT count(*) FROM public.suppliers),
    'entidades', (SELECT count(*) FROM public.business_entities),
    'locais', (SELECT count(*) FROM public.locations),
    'produtos', (SELECT count(*) FROM public.products),
    'variantes', (SELECT count(*) FROM public.product_variants),
    'categorias', (SELECT count(*) FROM public.categories WHERE parent_id IS NULL),
    'subcategorias', (SELECT count(*) FROM public.categories WHERE parent_id IS NOT NULL),
    'colecoes', (SELECT count(*) FROM public.collections),
    'candidaturas', (SELECT count(*) FROM public.leads),
    'usuarios', (SELECT count(*) FROM public.profiles)
  ) INTO res;
  RETURN res;
END; $function$;

-- 3) Guarda da hierarquia de categorias (dois níveis, sem ciclo)
create or replace function public.categories_hierarchy_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_avo uuid; v_filhos int;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'Uma categoria não pode ser subcategoria dela mesma.';
  end if;
  select parent_id into v_avo from public.categories where id = new.parent_id;
  if v_avo is not null then
    raise exception 'A estrutura aceita apenas categoria e subcategoria (dois níveis).';
  end if;
  select count(*) into v_filhos from public.categories where parent_id = new.id;
  if v_filhos > 0 then
    raise exception 'Esta categoria já possui subcategorias e não pode virar subcategoria.';
  end if;
  return new;
end $$;

drop trigger if exists categories_hierarchy_guard on public.categories;
create trigger categories_hierarchy_guard
  before insert or update of parent_id on public.categories
  for each row execute function public.categories_hierarchy_guard();

create index if not exists categories_parent_idx on public.categories (parent_id);