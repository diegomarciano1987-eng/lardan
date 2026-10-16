
-- Salva os parâmetros de montagem de remessa com auditoria (somente quem gerencia maletas).
CREATE OR REPLACE FUNCTION public.remessa_parametros_salvar(
  _pecas_cliente_nova int,
  _meta_colares int,
  _meta_pulseiras int,
  _meta_aneis int,
  _meta_tornozeleiras int
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _antes remessa_parametros%ROWTYPE;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para alterar os parâmetros de remessa.';
  END IF;
  IF _pecas_cliente_nova < 1 OR _meta_colares < 0 OR _meta_pulseiras < 0 OR _meta_aneis < 0 OR _meta_tornozeleiras < 0 THEN
    RAISE EXCEPTION 'Valores inválidos: total mínimo 1 e metas não podem ser negativas.';
  END IF;
  SELECT * INTO _antes FROM remessa_parametros WHERE id = true;
  UPDATE remessa_parametros SET
    pecas_cliente_nova = _pecas_cliente_nova,
    meta_colares = _meta_colares,
    meta_pulseiras = _meta_pulseiras,
    meta_aneis = _meta_aneis,
    meta_tornozeleiras = _meta_tornozeleiras,
    updated_by = auth.uid(),
    updated_at = now()
  WHERE id = true;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'remessa_parametros_salvar', 'remessa_parametros', 'padrao', jsonb_build_object(
    'antes', to_jsonb(_antes),
    'depois', jsonb_build_object(
      'pecas_cliente_nova', _pecas_cliente_nova,
      'meta_colares', _meta_colares,
      'meta_pulseiras', _meta_pulseiras,
      'meta_aneis', _meta_aneis,
      'meta_tornozeleiras', _meta_tornozeleiras)));
END;
$$;
GRANT EXECUTE ON FUNCTION public.remessa_parametros_salvar(int, int, int, int, int) TO authenticated;
