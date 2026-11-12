-- 0300 item 1 (Diego, 12/11/2026): a Qualidade (colaboradora com módulo Trocas e garantias) vê TODAS as maletas que precisam
-- voltar para a empresa, de qualquer representante/praça. Antes, colaboradora por código ficava presa à carteira do
-- representante ligado ao cadastro dela (Tatiane 1006 -> Daniel) e não via as maletas do Marcelo (remessa 926).
-- has_capability só honra módulos de colaboradora com colab_acessos ativo; consultora/representante seguem pelo escopo da maleta.
CREATE OR REPLACE FUNCTION public.retorno_ciclo_alcance(_cycle uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(public.kit_cycle_in_scope(_cycle), false)
      OR coalesce(public.has_capability(auth.uid(), 'quality.view'), false)
      OR coalesce(public.has_capability(auth.uid(), 'quality.manage'), false)
$$;
REVOKE ALL ON FUNCTION public.retorno_ciclo_alcance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retorno_ciclo_alcance(uuid) TO authenticated, service_role;