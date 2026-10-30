CREATE OR REPLACE VIEW public.colab_v_legado_pracas AS
 SELECT codigo, nome, dias, cidades, praca_id, atualizado_em
   FROM legado_pracas lp
  WHERE (NOT (SELECT colab_restrita())) OR lp.praca_id = ANY ((SELECT colab_praca_ids())::uuid[])
     OR lp.codigo IN (SELECT unnest(lr.pracas) FROM legado_representantes lr, parties p
                       WHERE p.id = (SELECT colab_rep()) AND (lr.party_id = p.id OR upper(trim(lr.nome)) = upper(trim(p.display_name))));

CREATE OR REPLACE VIEW public.colab_v_cob_pracas AS
 SELECT id, codigo, nome, ativo, created_at
   FROM cob_pracas p
  WHERE (NOT (SELECT colab_restrita())) OR p.id = ANY ((SELECT colab_praca_ids())::uuid[]);