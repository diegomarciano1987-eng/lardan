-- PROPOSTA — NÃO APLICAR sem revisão humana. Não é migração automática.
-- Vincula a empresa emissora (TSM COMERCIO DE SEMIJOIAS LTDA, CNPJ 43.319.208/0001-80)
-- à pessoa já existente, sem duplicar pessoa nem empresa. Emissão permanece desligada.
-- Dados de razão social/IE/regime/endereço: INFORMADOS PELO CLIENTE (ver docs/lardan/FISCAL-DADOS-EMPRESA.md).
-- Não altera papel de consultora, RG, endereço ou situação da pessoa: conflitos pendentes de decisão.

BEGIN;
DO $$
DECLARE v_party uuid; v_n integer; v_entity uuid;
BEGIN
  SELECT count(*), min(id::text)::uuid INTO v_n, v_party
    FROM public.parties WHERE doc_canon = '43319208000180';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Esperada exatamente uma pessoa com o CNPJ; encontradas %. Revisar antes.', v_n;
  END IF;

  SELECT id INTO v_entity FROM public.business_entities
   WHERE regexp_replace(coalesce(tax_id,''),'\D','','g') = '43319208000180';
  IF v_entity IS NULL THEN
    INSERT INTO public.business_entities (legal_name, trade_name, tax_id, state_registration, city, uf, notes, is_active, party_id)
    VALUES ('TSM COMERCIO DE SEMIJOIAS LTDA', 'LARDAN SEMIJOIAS', '43319208000180', '9090830101',
            'Ibiporã', 'PR',
            'Dados informados pelo cliente em 23/09/2026. Regime informado: Simples Nacional. '
            'Endereço informado: Av. dos Estudantes, 1277, Setor 1, CEP 86200-055.',
            true, v_party)
    RETURNING id INTO v_entity;
  END IF;

  UPDATE public.fiscal_settings
     SET emitter_entity_id = v_entity,
         note = 'Emissor vinculado por proposta revisada. Emissão desligada; nenhum provedor, série, CFOP ou tributação definidos.',
         updated_at = now()
   WHERE emission_active = false AND provider IS NULL;
END $$;
-- Conferir antes de confirmar:
-- SELECT * FROM public.business_entities; SELECT * FROM public.fiscal_settings;
ROLLBACK; -- trocar por COMMIT apenas após aprovação
