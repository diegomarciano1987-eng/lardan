-- 1. order_set_status: autorização à prova de NULL (regra comercial inalterada)
CREATE OR REPLACE FUNCTION public.order_set_status(_order uuid, _status text, _note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE o public.sales_orders; uid uuid := auth.uid(); eu uuid; novo public.sales_order_status;
        it record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  eu := public.my_party_id();
  SELECT * INTO o FROM public.sales_orders WHERE id = _order FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF public.has_capability(uid,'kit.manage') IS NOT TRUE
     AND (eu IS NULL OR o.consultora_party_id IS DISTINCT FROM eu) THEN
    RAISE EXCEPTION 'Sem permissão para atender este pedido.' USING errcode='42501';
  END IF;
  novo := _status::public.sales_order_status;
  IF o.status = novo THEN
    RETURN jsonb_build_object('situacao', o.status, 'repetido', true);
  END IF;
  IF o.status IN ('concluido','cancelado') THEN
    RAISE EXCEPTION 'Este pedido já foi encerrado.';
  END IF;

  IF novo = 'cancelado' THEN
    FOR it IN SELECT * FROM public.sales_order_items WHERE order_id = o.id LOOP
      UPDATE public.kit_balances
         SET qty_reserved = greatest(qty_reserved - it.quantity, 0), updated_at = now()
       WHERE cycle_id = it.cycle_id AND variant_id = it.variant_id;
    END LOOP;
    UPDATE public.sales_orders SET status = novo, cancelled_at = now(), cancel_reason = _note
     WHERE id = o.id;
  ELSIF novo = 'concluido' THEN
    UPDATE public.sales_orders SET status = novo, completed_at = now() WHERE id = o.id;
  ELSE
    UPDATE public.sales_orders SET status = novo WHERE id = o.id;
  END IF;

  INSERT INTO public.sales_order_events (order_id, kind, title, note, actor_id)
  VALUES (o.id, 'status', 'Situação alterada para ' || novo::text, _note, uid);

  RETURN jsonb_build_object('situacao', novo, 'repetido', false);
END $function$;

-- 2. showcase_save: sem pessoa vinculada não grava vitrine de terceiro
CREATE OR REPLACE FUNCTION public.showcase_save(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  eu uuid;
  alvo uuid;
  s text := lower(regexp_replace(coalesce(_payload->>'slug',''), '[^a-zA-Z0-9-]', '', 'g'));
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  eu := public.my_party_id();
  alvo := coalesce(nullif(_payload->>'party_id','')::uuid, eu);
  IF alvo IS NULL THEN RAISE EXCEPTION 'Cadastro de pessoa não vinculado ao seu usuário.'; END IF;
  IF (eu IS NULL OR alvo IS DISTINCT FROM eu)
     AND public.has_capability(uid,'kit.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'Sem permissão para alterar a vitrine de outra consultora.' USING errcode='42501';
  END IF;
  IF length(s) < 3 THEN RAISE EXCEPTION 'Escolha um endereço com pelo menos 3 letras.'; END IF;
  IF public.showcase_slug_reserved(s) THEN RAISE EXCEPTION 'Este endereço é reservado pelo site.'; END IF;
  IF EXISTS (SELECT 1 FROM public.consultant_showcases WHERE slug = s AND party_id <> alvo) THEN
    RAISE EXCEPTION 'Este endereço já está em uso.';
  END IF;

  INSERT INTO public.consultant_showcases (party_id, slug, headline, bio, whatsapp, is_public)
  VALUES (alvo, s, nullif(_payload->>'headline',''), nullif(_payload->>'bio',''),
          regexp_replace(coalesce(_payload->>'whatsapp',''),'[^0-9]','','g'),
          coalesce((_payload->>'is_public')::boolean, true))
  ON CONFLICT (party_id) DO UPDATE
     SET slug = excluded.slug,
         headline = excluded.headline,
         bio = excluded.bio,
         whatsapp = excluded.whatsapp,
         is_public = excluded.is_public,
         updated_at = now();

  RETURN jsonb_build_object('ok', true, 'slug', s, 'party_id', alvo);
END $function$;

-- 3. Execução: fecha o que ainda estava aberto a PUBLIC/visitante
REVOKE EXECUTE ON FUNCTION public.kit_board(jsonb, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.kit_require_cycle(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.kit_block_direct_write() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.kit_block_frozen_composition() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.showcase_slug_reserved(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_board(jsonb, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kit_require_cycle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.showcase_slug_reserved(text) TO authenticated;