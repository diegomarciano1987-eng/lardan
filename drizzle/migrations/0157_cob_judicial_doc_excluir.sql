create or replace function public.cob_judicial_doc_excluir(_id uuid, _motivo text)
returns table(storage_path text, party_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v record;
begin
  if not public.cob_pode(auth.uid()) then raise exception 'Sem permissão de cobrança'; end if;
  if length(trim(coalesce(_motivo,''))) < 3 then raise exception 'Informe o motivo da exclusão'; end if;
  delete from cob_judicial_docs d where d.id = _id
  returning d.storage_path, d.party_id, d.titulo, d.file_name into v;
  if not found then raise exception 'Documento não encontrado'; end if;
  insert into cob_interacoes(party_id,tipo,observacao,autor_id)
  values(v.party_id,'anotacao','Documento judicial removido: '||left(v.titulo,200)||' — motivo: '||left(trim(_motivo),300),auth.uid());
  insert into audit_logs(actor_id,action,entity,entity_id,payload)
  values(auth.uid(),'cob_judicial_doc_excluir','cob_judicial_docs',_id::text,jsonb_build_object('party_id',v.party_id,'titulo',v.titulo,'file_name',v.file_name,'motivo',left(trim(_motivo),300)));
  return query select v.storage_path, v.party_id;
end $function$;
revoke all on function public.cob_judicial_doc_excluir(uuid,text) from public, anon;
grant execute on function public.cob_judicial_doc_excluir(uuid,text) to authenticated;