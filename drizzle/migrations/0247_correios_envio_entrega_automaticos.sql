-- 0247 — Correios: envio e entrega da maleta confirmados sozinhos pelo rastreio (Diego, 05/11/2026).

alter table public.correios_envios add column if not exists auto_expedida_em timestamptz;
alter table public.correios_envios add column if not exists auto_entregue_em timestamptz;
alter table public.correios_envios add column if not exists auto_erro text;

create or replace function public.correios_envio_rastro(_id uuid, _eventos jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare e record; postado timestamptz; entregue timestamptz; novo text; kc record; ator uuid; claims text;
begin
  if not public.correios_eh_servidor() then raise exception 'Só o servidor.' using errcode = '42501'; end if;
  select * into e from correios_envios where id = _id for update;
  if not found then raise exception 'Envio inexistente.'; end if;
  _eventos := coalesce(_eventos, '[]'::jsonb);
  select min((x->>'dtHrCriado')::timestamp at time zone 'America/Sao_Paulo') into postado
    from jsonb_array_elements(_eventos) x where x->>'codigo' = 'PO';
  select min((x->>'dtHrCriado')::timestamp at time zone 'America/Sao_Paulo') into entregue
    from jsonb_array_elements(_eventos) x where x->>'codigo' in ('BDE','BDI','BDR') and x->>'tipo' in ('01','1');
  novo := case when entregue is not null then 'entregue'
               when postado is not null or jsonb_array_length(_eventos) > 0 then
                 case when e.status in ('pre_postada','postada') and postado is not null and jsonb_array_length(_eventos) <= 1 then 'postada' else 'em_transito' end
               else e.status end;
  if e.status in ('cancelada','erro','expirada') then novo := e.status; end if;
  update correios_envios set eventos = _eventos, rastreado_em = now(), status = novo,
         postado_em = coalesce(postado_em, postado), entregue_em = coalesce(entregue_em, entregue), updated_at = now()
   where id = _id returning * into e;

  if e.direcao = 'ida' and e.status not in ('cancelada','erro','expirada') and (e.postado_em is not null or e.entregue_em is not null) then
    select * into kc from kit_cycles where id = e.cycle_id;
    ator := e.criado_por;
    if ator is not null and kc.id is not null then
      claims := current_setting('request.jwt.claims', true);
      perform set_config('request.jwt.claims', json_build_object('sub', ator, 'role', 'authenticated')::text, true);
      begin
        if kc.status::text = 'conferida' and e.auto_expedida_em is null then
          perform public.kit_expedir(e.cycle_id, jsonb_build_object('rota', 'direta', 'note', 'Postada nos Correios ' || coalesce(e.codigo_objeto, '')));
          update correios_envios set auto_expedida_em = now() where id = e.id;
        end if;
        if e.entregue_em is not null and e.auto_entregue_em is null then
          select * into kc from kit_cycles where id = e.cycle_id;
          if kc.status::text in ('conferida','expedida','transito') then
            perform public.kit_liberar_consultora(e.cycle_id);
          end if;
          update correios_envios set auto_entregue_em = now(), auto_erro = null where id = e.id;
        end if;
      exception when others then
        update correios_envios set auto_erro = left(SQLERRM, 300) where id = e.id;
      end;
      perform set_config('request.jwt.claims', coalesce(claims, ''), true);
    end if;
  end if;

  if e.direcao = 'ida' and e.entregue_em is not null then
    update kit_cycles set due_at = e.entregue_em + interval '30 days', updated_at = now()
     where id = e.cycle_id and status::text not in ('encerrada','cancelada','acerto')
       and due_at is distinct from e.entregue_em + interval '30 days';
  end if;
  select * into e from correios_envios where id = _id;
  return to_jsonb(e);
end $$;
revoke all on function public.correios_envio_rastro(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.correios_envio_rastro(uuid, jsonb) to service_role;

do $$
declare d text; novo text;
begin
  d := pg_get_functiondef('public.correios_painel(uuid)'::regprocedure);
  novo := replace(d, $a$'tem_rotulo', e.rotulo_path is not null, 'erro', e.erro,$a$,
    $b$'tem_rotulo', e.rotulo_path is not null, 'erro', coalesce(e.erro, case when e.auto_erro is not null then 'Não deu para confirmar sozinho (confirme à mão): ' || e.auto_erro end),$b$);
  if position('auto_erro' in d) > 0 then return; end if;
  if novo = d then raise exception '0247: trecho do painel dos Correios não encontrado'; end if;
  execute novo;
end $$;