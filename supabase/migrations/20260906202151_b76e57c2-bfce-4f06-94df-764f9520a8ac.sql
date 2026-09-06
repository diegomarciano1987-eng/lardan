-- ============================================================
-- Bloco A — documentos de fornecedores e entidades no servidor
-- ============================================================

-- 1) Tira tax_id do alcance da leitura direta pela Data API.
REVOKE SELECT ON public.suppliers FROM authenticated, anon;
GRANT SELECT (id, name, trade_name, contact_name, email, phone, city, uf,
              notes, is_active, created_by, created_at, updated_at, party_id)
  ON public.suppliers TO authenticated;

REVOKE SELECT ON public.business_entities FROM authenticated, anon;
GRANT SELECT (id, legal_name, trade_name, state_registration, city, uf,
              notes, is_active, created_by, created_at, updated_at, party_id)
  ON public.business_entities TO authenticated;

-- 2) Listagem canônica, sempre mascarada.
CREATE OR REPLACE FUNCTION public.partners_list(
  _kind text,
  _search text DEFAULT NULL,
  _page int DEFAULT 0,
  _size int DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE termo text; ini int; tam int; total int; linhas jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'partners.view') THEN
    RAISE EXCEPTION 'Sem permissão para ver parceiros.';
  END IF;
  IF _kind NOT IN ('fornecedor','entidade') THEN
    RAISE EXCEPTION 'Tipo inválido.';
  END IF;

  termo := nullif(trim(coalesce(_search,'')),'');
  tam := least(greatest(coalesce(_size,20),1),100);
  ini := greatest(coalesce(_page,0),0) * tam;

  IF _kind = 'fornecedor' THEN
    SELECT count(*) INTO total FROM public.suppliers s
     WHERE termo IS NULL
        OR s.name ILIKE '%'||termo||'%'
        OR coalesce(s.trade_name,'') ILIKE '%'||termo||'%'
        OR coalesce(s.contact_name,'') ILIKE '%'||termo||'%'
        OR coalesce(s.email,'') ILIKE '%'||termo||'%'
        OR coalesce(s.city,'') ILIKE '%'||termo||'%'
        OR public.only_digits(s.tax_id) = public.only_digits(termo);

    SELECT coalesce(jsonb_agg(x ORDER BY x->>'nome'), '[]'::jsonb) INTO linhas FROM (
      SELECT jsonb_build_object(
        'id', s.id, 'nome', s.name, 'fantasia', s.trade_name,
        'doc_mascarado', public.mask_doc(s.tax_id),
        'tem_doc', s.tax_id IS NOT NULL,
        'contato', s.contact_name, 'email', s.email, 'telefone', s.phone,
        'cidade', s.city, 'uf', s.uf, 'notas', s.notes, 'ativo', s.is_active
      ) AS x
      FROM public.suppliers s
      WHERE termo IS NULL
         OR s.name ILIKE '%'||termo||'%'
         OR coalesce(s.trade_name,'') ILIKE '%'||termo||'%'
         OR coalesce(s.contact_name,'') ILIKE '%'||termo||'%'
         OR coalesce(s.email,'') ILIKE '%'||termo||'%'
         OR coalesce(s.city,'') ILIKE '%'||termo||'%'
         OR public.only_digits(s.tax_id) = public.only_digits(termo)
      ORDER BY s.name
      LIMIT tam OFFSET ini
    ) q;
  ELSE
    SELECT count(*) INTO total FROM public.business_entities b
     WHERE termo IS NULL
        OR b.legal_name ILIKE '%'||termo||'%'
        OR coalesce(b.trade_name,'') ILIKE '%'||termo||'%'
        OR coalesce(b.city,'') ILIKE '%'||termo||'%'
        OR public.only_digits(b.tax_id) = public.only_digits(termo);

    SELECT coalesce(jsonb_agg(x ORDER BY x->>'nome'), '[]'::jsonb) INTO linhas FROM (
      SELECT jsonb_build_object(
        'id', b.id, 'nome', b.legal_name, 'fantasia', b.trade_name,
        'doc_mascarado', public.mask_doc(b.tax_id),
        'tem_doc', b.tax_id IS NOT NULL,
        'inscricao_estadual', b.state_registration,
        'cidade', b.city, 'uf', b.uf, 'notas', b.notes, 'ativo', b.is_active
      ) AS x
      FROM public.business_entities b
      WHERE termo IS NULL
         OR b.legal_name ILIKE '%'||termo||'%'
         OR coalesce(b.trade_name,'') ILIKE '%'||termo||'%'
         OR coalesce(b.city,'') ILIKE '%'||termo||'%'
         OR public.only_digits(b.tax_id) = public.only_digits(termo)
      ORDER BY b.legal_name
      LIMIT tam OFFSET ini
    ) q;
  END IF;

  RETURN jsonb_build_object(
    'rows', linhas,
    'total', coalesce(total,0),
    'pode_revelar', public.has_capability(auth.uid(),'registry.doc.view'),
    'pode_gerir', public.has_capability(auth.uid(),'partners.manage')
  );
END $$;

REVOKE ALL ON FUNCTION public.partners_list(text,text,int,int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.partners_list(text,text,int,int) TO authenticated;

-- 3) Revelação auditada do documento completo.
CREATE OR REPLACE FUNCTION public.partner_doc_reveal(_kind text, _id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE doc text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'registry.doc.view') THEN
    RAISE EXCEPTION 'Sem permissão para ver documentos.';
  END IF;
  IF _kind = 'fornecedor' THEN
    SELECT tax_id INTO doc FROM public.suppliers WHERE id = _id;
  ELSIF _kind = 'entidade' THEN
    SELECT tax_id INTO doc FROM public.business_entities WHERE id = _id;
  ELSE
    RAISE EXCEPTION 'Tipo inválido.';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'doc.reveal', _kind, _id::text,
          jsonb_build_object('tem_doc', doc IS NOT NULL));

  RETURN doc;
END $$;

REVOKE ALL ON FUNCTION public.partner_doc_reveal(text,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.partner_doc_reveal(text,uuid) TO authenticated;

-- 4) Gravação canônica: o documento só é alterado por quem pode vê-lo.
CREATE OR REPLACE FUNCTION public.partner_save(_kind text, _id uuid, _values jsonb)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE novo uuid; pode_doc boolean; doc text; tem_doc boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'partners.manage') THEN
    RAISE EXCEPTION 'Sem permissão para gerir parceiros.';
  END IF;
  pode_doc := public.has_capability(auth.uid(),'registry.doc.view');
  tem_doc  := _values ? 'doc';
  doc      := nullif(trim(coalesce(_values->>'doc','')),'');
  IF tem_doc AND NOT pode_doc THEN
    RAISE EXCEPTION 'Sem permissão para alterar o documento.';
  END IF;

  IF _kind = 'fornecedor' THEN
    IF _id IS NULL THEN
      INSERT INTO public.suppliers (name, trade_name, tax_id, contact_name, email, phone,
                                    city, uf, notes, is_active, created_by)
      VALUES (nullif(trim(coalesce(_values->>'nome','')),''),
              nullif(trim(coalesce(_values->>'fantasia','')),''),
              CASE WHEN tem_doc THEN doc ELSE NULL END,
              nullif(trim(coalesce(_values->>'contato','')),''),
              nullif(trim(coalesce(_values->>'email','')),''),
              nullif(trim(coalesce(_values->>'telefone','')),''),
              nullif(trim(coalesce(_values->>'cidade','')),''),
              nullif(trim(coalesce(_values->>'uf','')),''),
              nullif(trim(coalesce(_values->>'notas','')),''),
              coalesce((_values->>'ativo')::boolean, true), auth.uid())
      RETURNING id INTO novo;
    ELSE
      UPDATE public.suppliers SET
        name = coalesce(nullif(trim(coalesce(_values->>'nome','')),''), name),
        trade_name = nullif(trim(coalesce(_values->>'fantasia','')),''),
        tax_id = CASE WHEN tem_doc THEN doc ELSE tax_id END,
        contact_name = nullif(trim(coalesce(_values->>'contato','')),''),
        email = nullif(trim(coalesce(_values->>'email','')),''),
        phone = nullif(trim(coalesce(_values->>'telefone','')),''),
        city = nullif(trim(coalesce(_values->>'cidade','')),''),
        uf = nullif(trim(coalesce(_values->>'uf','')),''),
        notes = nullif(trim(coalesce(_values->>'notas','')),''),
        is_active = coalesce((_values->>'ativo')::boolean, is_active),
        updated_at = now()
      WHERE id = _id RETURNING id INTO novo;
    END IF;
  ELSIF _kind = 'entidade' THEN
    IF _id IS NULL THEN
      INSERT INTO public.business_entities (legal_name, trade_name, tax_id, state_registration,
                                            city, uf, notes, is_active, created_by)
      VALUES (nullif(trim(coalesce(_values->>'nome','')),''),
              nullif(trim(coalesce(_values->>'fantasia','')),''),
              CASE WHEN tem_doc THEN doc ELSE NULL END,
              nullif(trim(coalesce(_values->>'inscricao_estadual','')),''),
              nullif(trim(coalesce(_values->>'cidade','')),''),
              nullif(trim(coalesce(_values->>'uf','')),''),
              nullif(trim(coalesce(_values->>'notas','')),''),
              coalesce((_values->>'ativo')::boolean, true), auth.uid())
      RETURNING id INTO novo;
    ELSE
      UPDATE public.business_entities SET
        legal_name = coalesce(nullif(trim(coalesce(_values->>'nome','')),''), legal_name),
        trade_name = nullif(trim(coalesce(_values->>'fantasia','')),''),
        tax_id = CASE WHEN tem_doc THEN doc ELSE tax_id END,
        state_registration = nullif(trim(coalesce(_values->>'inscricao_estadual','')),''),
        city = nullif(trim(coalesce(_values->>'cidade','')),''),
        uf = nullif(trim(coalesce(_values->>'uf','')),''),
        notes = nullif(trim(coalesce(_values->>'notas','')),''),
        is_active = coalesce((_values->>'ativo')::boolean, is_active),
        updated_at = now()
      WHERE id = _id RETURNING id INTO novo;
    END IF;
  ELSE
    RAISE EXCEPTION 'Tipo inválido.';
  END IF;

  IF novo IS NULL THEN RAISE EXCEPTION 'Registro não encontrado.'; END IF;
  RETURN novo;
END $$;

REVOKE ALL ON FUNCTION public.partner_save(text,uuid,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.partner_save(text,uuid,jsonb) TO authenticated;