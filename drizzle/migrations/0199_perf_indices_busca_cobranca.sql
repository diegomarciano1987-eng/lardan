CREATE INDEX IF NOT EXISTS parties_display_name_trgm_idx ON public.parties USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS parties_legal_name_trgm_idx ON public.parties USING gin (legal_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS parties_code_trgm_idx ON public.parties USING gin ((code::text) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS product_variants_sku_trgm_idx ON public.product_variants USING gin (sku gin_trgm_ops);
CREATE INDEX IF NOT EXISTS product_variants_label_trgm_idx ON public.product_variants USING gin (label gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cob_tarefas_party_status_vence_idx ON public.cob_tarefas (party_id, status, vence_em);
CREATE INDEX IF NOT EXISTS financial_installments_abertas_idx ON public.financial_installments (title_id) WHERE settlement_status IN ('nao_liquidado','parcial');