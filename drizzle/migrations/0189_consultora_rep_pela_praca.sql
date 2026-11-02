-- Representante deduzido da praça somente quando há UM único representante ativo atendendo a praça.
CREATE OR REPLACE FUNCTION public.consultora_rep_pela_praca(_praca uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select case when count(distinct cp.representative_party_id) = 1 then min(cp.representative_party_id::text)::uuid end
  from consultant_profiles cp
  join parties r on r.id = cp.representative_party_id and r.status = 'ativo'
  join party_roles pr on pr.party_id = r.id and pr.role = 'representante'
  where cp.praca_id = _praca and _praca is not null
$$;
REVOKE ALL ON FUNCTION public.consultora_rep_pela_praca(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consultora_rep_pela_praca(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultora_rep_da_praca_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin
  if new.representative_party_id is null and new.praca_id is not null then
    new.representative_party_id := public.consultora_rep_pela_praca(new.praca_id);
  end if;
  return new;
end $$;
REVOKE ALL ON FUNCTION public.consultora_rep_da_praca_trg() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS aa_consultora_rep_da_praca ON public.consultant_profiles;
CREATE TRIGGER aa_consultora_rep_da_praca BEFORE INSERT OR UPDATE OF praca_id, representative_party_id ON public.consultant_profiles
FOR EACH ROW EXECUTE FUNCTION public.consultora_rep_da_praca_trg();

-- Auditoria: consultoras ativas com praça ativa e sem representante, com o motivo.
CREATE OR REPLACE FUNCTION public.rede_auditoria_sem_representante()
RETURNS TABLE(party_id uuid, nome text, praca_codigo int, praca_nome text, sugestao_rep uuid, sugestao_nome text, reps_na_praca jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
begin
  if not (has_capability(auth.uid(),'registry.view') or cob_pode(auth.uid())) then raise exception 'Sem permissão'; end if;
  return query
  select cp.party_id, p.display_name, pc.codigo, pc.nome,
    public.consultora_rep_pela_praca(cp.praca_id),
    (select display_name from parties where id = public.consultora_rep_pela_praca(cp.praca_id)),
    (select coalesce(jsonb_agg(jsonb_build_object('rep', r.display_name, 'consultoras', x.n) order by x.n desc), '[]')
       from (select c2.representative_party_id rid, count(*) n from consultant_profiles c2 where c2.praca_id = cp.praca_id and c2.representative_party_id is not null group by 1) x
       join parties r on r.id = x.rid and r.status = 'ativo')
  from consultant_profiles cp
  join parties p on p.id = cp.party_id and p.status in ('ativo','aprovado')
  join cob_pracas pc on pc.id = cp.praca_id and pc.ativo
  where cp.representative_party_id is null
  order by pc.codigo, p.display_name;
end $$;
REVOKE ALL ON FUNCTION public.rede_auditoria_sem_representante() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rede_auditoria_sem_representante() TO authenticated, service_role;

-- Correção: só praças com representante único (auditado por trg_audit_consultant_profiles).
UPDATE public.consultant_profiles cp
   SET representative_party_id = public.consultora_rep_pela_praca(cp.praca_id)
 WHERE cp.representative_party_id IS NULL
   AND cp.praca_id IS NOT NULL
   AND public.consultora_rep_pela_praca(cp.praca_id) IS NOT NULL
   AND EXISTS (select 1 from parties p where p.id = cp.party_id and p.status in ('ativo','aprovado'));