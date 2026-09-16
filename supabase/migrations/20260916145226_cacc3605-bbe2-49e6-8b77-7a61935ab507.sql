
CREATE OR REPLACE FUNCTION public.import_pessoas(_rows jsonb, _papel text, _dry_run boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  r jsonb; v_uid uuid := auth.uid();
  v_nome text; v_doc text; v_email text; v_fone text; v_fone_norm text;
  v_kind party_kind; v_papel party_role_kind; v_id uuid; v_sit text; v_motivo text;
  v_nasc date; v_obs text; v_prof text;
  v_novos int := 0; v_vinc int := 0; v_atu int := 0; v_igual int := 0;
  v_conf int := 0; v_rec int := 0; v_pend int := 0; v_n int := 0;
  v_linhas jsonb := '[]'::jsonb; v_mudou boolean;
  v_ex_id uuid; v_ex_nome text; v_ex_nasc date; v_ex_prof text; v_ex_obs text;
begin
  if v_uid is null then raise exception 'Não autenticado'; end if;
  if not (has_capability(v_uid,'registry.manage') and has_capability(v_uid,'imports.run')) then
    raise exception 'Sem permissão para importar cadastros';
  end if;
  begin v_papel := _papel::party_role_kind;
  exception when others then raise exception 'Papel inválido: %', _papel; end;

  for r in select * from jsonb_array_elements(coalesce(_rows,'[]'::jsonb)) loop
    v_n := v_n + 1; v_id := null; v_sit := null; v_motivo := null;
    v_ex_id := null; v_ex_nome := null; v_ex_nasc := null; v_ex_prof := null; v_ex_obs := null;
    v_nome  := imp_texto(r->>'nome');
    v_doc   := nullif(regexp_replace(coalesce(r->>'documento',''), '[^0-9]', '', 'g'), '');
    v_email := lower(imp_texto(r->>'email'));
    v_fone  := imp_texto(r->>'telefone');
    v_fone_norm := nullif(regexp_replace(coalesce(v_fone,''), '[^0-9]', '', 'g'), '');
    v_nasc  := imp_data(r->>'nascimento');
    v_obs   := imp_texto(r->>'observacao');
    v_prof  := imp_texto(r->>'profissao');
    v_kind  := case when v_doc is not null and length(v_doc) = 14 then 'organizacao' else 'pessoa' end::party_kind;

    if v_nome is null then
      v_sit := 'recusado'; v_motivo := 'Linha sem nome.';
    elsif v_doc is not null and not doc_is_valid(v_doc) then
      v_sit := 'recusado'; v_motivo := 'CPF/CNPJ inválido: ' || v_doc;
    elsif v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_sit := 'recusado'; v_motivo := 'E-mail inválido: ' || v_email;
    end if;

    if v_sit is null then
      if v_doc is not null then
        select p.id, p.display_name, p.birth_date, p.profession, p.notes
          into v_ex_id, v_ex_nome, v_ex_nasc, v_ex_prof, v_ex_obs
        from parties p where p.doc_digits = v_doc limit 1;
      end if;
      if v_ex_id is null and (v_email is not null or v_fone_norm is not null) then
        select p.id, p.display_name, p.birth_date, p.profession, p.notes
          into v_ex_id, v_ex_nome, v_ex_nasc, v_ex_prof, v_ex_obs
        from parties p join contact_points c on c.party_id = p.id
        where c.value_norm in (coalesce(v_email,'@'), coalesce(v_fone_norm,'@')) limit 1;
      end if;
      if v_ex_id is null and v_doc is null and v_email is null and v_fone_norm is null then
        if exists (select 1 from parties p
                   where fin_unaccent_lower(coalesce(p.display_name,'')) = fin_unaccent_lower(v_nome)) then
          v_sit := 'pendente';
          v_motivo := 'Já existe cadastro com este nome e a linha não trouxe documento nem contato.';
        end if;
      end if;
    end if;

    if v_sit is null then
      if v_ex_id is not null then
        v_id := v_ex_id;
        if v_doc is not null and v_ex_nome is not null
           and fin_unaccent_lower(v_ex_nome) <> fin_unaccent_lower(v_nome) then
          v_sit := 'conflito';
          v_motivo := 'Documento já cadastrado para "' || v_ex_nome || '".';
          v_id := null;
        else
          v_mudou := false;
          if not _dry_run then
            update parties p set
              birth_date = coalesce(p.birth_date, v_nasc),
              profession = coalesce(p.profession, v_prof),
              notes = coalesce(p.notes, v_obs),
              updated_by = v_uid
            where p.id = v_id
              and ((p.birth_date is null and v_nasc is not null)
                or (p.profession is null and v_prof is not null)
                or (p.notes is null and v_obs is not null));
            if found then v_mudou := true; end if;
          else
            v_mudou := (v_ex_nasc is null and v_nasc is not null)
                    or (v_ex_prof is null and v_prof is not null)
                    or (v_ex_obs is null and v_obs is not null);
          end if;
          if exists (select 1 from party_roles pr where pr.party_id = v_id and pr.role = v_papel) then
            v_sit := case when v_mudou then 'atualizado' else 'sem_alteracao' end;
          else
            if not _dry_run then
              insert into party_roles (party_id, role, created_by) values (v_id, v_papel, v_uid);
              if v_papel = 'consultora' then
                insert into consultant_profiles (party_id) values (v_id) on conflict (party_id) do nothing;
              end if;
            end if;
            v_sit := 'vinculado';
          end if;
        end if;
      else
        if not _dry_run then
          insert into parties (kind, display_name, doc, doc_digits, birth_date, profession, notes, status, created_by, updated_by)
          values (v_kind, v_nome, v_doc, v_doc, v_nasc, v_prof, v_obs, 'rascunho', v_uid, v_uid)
          returning id into v_id;
          insert into party_roles (party_id, role, created_by) values (v_id, v_papel, v_uid);
          if v_papel = 'consultora' then
            insert into consultant_profiles (party_id) values (v_id) on conflict (party_id) do nothing;
          end if;
        end if;
        v_sit := 'novo';
      end if;
    end if;

    if not _dry_run and v_id is not null and v_sit in ('novo','vinculado','atualizado','sem_alteracao') then
      if v_email is not null and not exists (select 1 from contact_points c where c.party_id = v_id and c.value_norm = v_email) then
        insert into contact_points (party_id, kind, value, is_primary)
        values (v_id, 'email', v_email, not exists (select 1 from contact_points c where c.party_id = v_id and c.kind = 'email'));
      end if;
      if v_fone_norm is not null and not exists (select 1 from contact_points c where c.party_id = v_id and c.value_norm = v_fone_norm) then
        insert into contact_points (party_id, kind, value, is_primary)
        values (v_id, 'whatsapp', v_fone, not exists (select 1 from contact_points c where c.party_id = v_id and c.kind = 'whatsapp'));
      end if;
    end if;

    v_linhas := v_linhas || jsonb_build_object('n', coalesce((r->>'n')::int, v_n), 'nome', v_nome,
      'situacao', v_sit, 'motivo', v_motivo, 'party_id', v_id);
    v_novos := v_novos + (v_sit = 'novo')::int;
    v_vinc  := v_vinc  + (v_sit = 'vinculado')::int;
    v_atu   := v_atu   + (v_sit = 'atualizado')::int;
    v_igual := v_igual + (v_sit = 'sem_alteracao')::int;
    v_conf  := v_conf  + (v_sit = 'conflito')::int;
    v_rec   := v_rec   + (v_sit = 'recusado')::int;
    v_pend  := v_pend  + (v_sit = 'pendente')::int;
  end loop;

  if not _dry_run then
    insert into audit_logs (entity, entity_id, action, actor_id, payload)
    values ('parties', null, 'import_pessoas', v_uid,
      jsonb_build_object('papel', _papel, 'recebidas', v_n, 'novos', v_novos, 'vinculados', v_vinc,
        'atualizados', v_atu, 'conflitos', v_conf, 'recusados', v_rec, 'pendentes', v_pend));
  end if;

  return jsonb_build_object(
    'simulacao', _dry_run,
    'contadores', jsonb_build_object('recebidas', v_n, 'novos', v_novos, 'vinculados', v_vinc,
      'atualizados', v_atu, 'sem_alteracao', v_igual, 'conflitos', v_conf,
      'recusados', v_rec, 'pendentes', v_pend),
    'linhas', v_linhas);
end $function$;

CREATE OR REPLACE FUNCTION public.import_titulos(_rows jsonb, _direction text, _dry_run boolean DEFAULT true, _criar_contraparte boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  r jsonb; v_uid uuid := auth.uid(); v_dir fin_direction; v_cap text;
  v_nome text; v_doc text; v_desc text; v_docnum text;
  v_venc date; v_emissao date; v_comp date; v_valor bigint;
  v_party uuid; v_sit text; v_motivo text; v_chave text; v_id uuid;
  v_n int := 0; v_novos int := 0; v_rep int := 0; v_rec int := 0; v_pend int := 0; v_pessoas int := 0;
  v_linhas jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'Não autenticado'; end if;
  begin v_dir := _direction::fin_direction;
  exception when others then raise exception 'Tipo inválido: %', _direction; end;
  v_cap := case when v_dir = 'payable' then 'finance.payable.manage' else 'finance.receivable.manage' end;
  if not (has_capability(v_uid, v_cap) and has_capability(v_uid,'imports.run')) then
    raise exception 'Sem permissão para importar títulos';
  end if;

  for r in select * from jsonb_array_elements(coalesce(_rows,'[]'::jsonb)) loop
    v_n := v_n + 1; v_sit := null; v_motivo := null; v_party := null; v_id := null;
    v_nome := imp_texto(r->>'contraparte');
    v_doc  := nullif(regexp_replace(coalesce(r->>'documento_contraparte',''), '[^0-9]', '', 'g'), '');
    v_desc := imp_texto(r->>'descricao');
    v_docnum := imp_texto(r->>'documento');
    v_venc := imp_data(r->>'vencimento');
    v_emissao := imp_data(r->>'emissao');
    v_comp := imp_data(r->>'competencia');
    v_valor := imp_valor_cents(r->>'valor');

    if v_nome is null and v_doc is null then
      v_sit := 'recusado'; v_motivo := 'Linha sem contraparte.';
    elsif v_valor is null or v_valor <= 0 then
      v_sit := 'recusado'; v_motivo := 'Valor ausente ou inválido: ' || coalesce(r->>'valor','');
    elsif v_venc is null then
      v_sit := 'recusado'; v_motivo := 'Vencimento ausente ou em data inexistente: ' || coalesce(r->>'vencimento','');
    end if;

    if v_sit is null then
      if v_doc is not null then
        select p.id into v_party from parties p where p.doc_digits = v_doc limit 1;
      end if;
      if v_party is null and v_nome is not null then
        select p.id into v_party from parties p
        where fin_unaccent_lower(coalesce(p.display_name,'')) = fin_unaccent_lower(v_nome) limit 1;
      end if;
      if v_party is null then
        if _criar_contraparte and v_nome is not null then
          if not _dry_run then
            insert into parties (kind, display_name, doc, doc_digits, status, created_by, updated_by)
            values (case when v_doc is not null and length(v_doc)=14 then 'organizacao' else 'pessoa' end::party_kind,
                    v_nome, v_doc, v_doc, 'rascunho', v_uid, v_uid)
            returning id into v_party;
            insert into party_roles (party_id, role, created_by)
            values (v_party, case when v_dir='payable' then 'fornecedor' else 'cliente' end::party_role_kind, v_uid);
          end if;
          v_pessoas := v_pessoas + 1;
        else
          v_sit := 'pendente';
          v_motivo := 'Contraparte "' || coalesce(v_nome, v_doc) || '" não existe no cadastro.';
        end if;
      end if;
    end if;

    if v_sit is null then
      v_chave := coalesce(imp_texto(r->>'id_externo'),
        md5(_direction || '|' || coalesce(v_doc, fin_unaccent_lower(coalesce(v_nome,''))) || '|' ||
            coalesce(v_docnum,'') || '|' || v_venc::text || '|' || v_valor::text));
      if exists (select 1 from financial_titles t
                 where t.sistema_origem = 'planilha' and t.id_externo = v_chave) then
        v_sit := 'repetido'; v_motivo := 'Título já importado anteriormente.';
      else
        if not _dry_run then
          v_id := fin_title_create(jsonb_build_object(
            'direction', _direction,
            'party_id', v_party,
            'descricao', coalesce(v_desc, 'Importado de planilha'),
            'documento', v_docnum,
            'emissao', v_emissao,
            'competencia', v_comp,
            'valor_cents', v_valor,
            'origem', 'importacao',
            'sistema_origem', 'planilha',
            'id_externo', v_chave,
            'observacao', imp_texto(r->>'observacao'),
            'parcelas', jsonb_build_array(jsonb_build_object('vencimento', v_venc::text, 'valor_cents', v_valor))
          ));
        end if;
        v_sit := 'novo';
      end if;
    end if;

    v_linhas := v_linhas || jsonb_build_object('n', coalesce((r->>'n')::int, v_n),
      'contraparte', v_nome, 'valor_cents', v_valor, 'vencimento', v_venc,
      'situacao', v_sit, 'motivo', v_motivo, 'title_id', v_id);
    v_novos := v_novos + (v_sit = 'novo')::int;
    v_rep   := v_rep   + (v_sit = 'repetido')::int;
    v_rec   := v_rec   + (v_sit = 'recusado')::int;
    v_pend  := v_pend  + (v_sit = 'pendente')::int;
  end loop;

  if not _dry_run then
    insert into audit_logs (entity, entity_id, action, actor_id, payload)
    values ('financial_titles', null, 'import_titulos', v_uid,
      jsonb_build_object('direcao', _direction, 'recebidas', v_n, 'novos', v_novos,
        'repetidos', v_rep, 'recusados', v_rec, 'pendentes', v_pend, 'contrapartes_criadas', v_pessoas));
  end if;

  return jsonb_build_object(
    'simulacao', _dry_run,
    'contadores', jsonb_build_object('recebidas', v_n, 'novos', v_novos, 'repetidos', v_rep,
      'recusados', v_rec, 'pendentes', v_pend, 'contrapartes_criadas', v_pessoas),
    'linhas', v_linhas);
end $function$;
