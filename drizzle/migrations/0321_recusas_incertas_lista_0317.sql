-- 0317 — a tela fiscal lista só as 30 notas mais recentes; as recusas incertas de dias atrás (as 3 do 635 de 12/11)
-- ficavam fora da lista e o botão de conferência não aparecia. Esta função devolve TODAS as recusas incertas
-- ainda sem conferência (produção), para a tela mostrar um quadro próprio no topo. Só leitura.
CREATE OR REPLACE FUNCTION public.fiscal_recusas_incertas_pendentes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.fiscal_focus_pode('ver') THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'ref', e.ref, 'operacao', e.operacao, 'status', e.status, 'status_sefaz', e.status_sefaz, 'mensagem_sefaz', e.mensagem_sefaz,
             'created_at', e.created_at, 'consultora', p.display_name, 'maleta', k.code,
             'outra_nota', (SELECT o.numero FROM fiscal_focus_envios o WHERE o.cycle_id = e.cycle_id AND o.ambiente = e.ambiente
                             AND o.operacao = e.operacao AND o.status = 'autorizado' AND o.ref <> e.ref ORDER BY o.created_at DESC LIMIT 1))
           ORDER BY e.created_at)
      FROM fiscal_focus_envios e
      LEFT JOIN parties p ON p.id = e.party_id
      LEFT JOIN kit_cycles c ON c.id = e.cycle_id
      LEFT JOIN kits k ON k.id = c.kit_id
     WHERE e.ambiente = 'producao'
       AND public.fiscal_recusa_incerta(e.status, e.status_sefaz, e.mensagem_sefaz, e.ref)
       AND NOT EXISTS (SELECT 1 FROM fiscal_recusas_conferidas r WHERE r.ref = e.ref)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fiscal_recusas_incertas_pendentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_recusas_incertas_pendentes() TO authenticated;