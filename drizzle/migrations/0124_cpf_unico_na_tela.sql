-- 0124 — Um CPF/CNPJ, um cadastro (pela tela).
--
-- Hoje a tela de cadastro confere se o documento já existe ANTES de salvar, mas o
-- banco aceita. Com duas abas abertas, um clique duplo ou uma edição da ficha
-- colocando o CPF de outra pessoa, nasce o cadastro repetido — e é exatamente
-- isso que esconde maleta do app da consultora (maleta num cadastro, login no
-- outro) e duplica cliente no Asaas.
--
-- Esta trava vale só para gravações feitas DIRETO pela tela (papel
-- `authenticated`). As rotinas do banco (importações, PDV, Asaas, cadastro do
-- histórico) continuam como estão: cada uma já procura o documento antes de
-- criar. Cadastros repetidos que já existem não são tocados; para juntá-los use
-- Cadastros → Duplicidades (party_unificar).
--
-- Não apaga nada, não altera coluna. Reversível com:
--   DROP TRIGGER IF EXISTS zy_parties_doc_unico ON public.parties;
--   DROP FUNCTION IF EXISTS public.parties_doc_unico();
--   DROP FUNCTION IF EXISTS public.parties_doc_em_uso(text, uuid);

-- Quem já usa o documento. Lê doc_digits (a tela não enxerga essa coluna) e só
-- responde a quem pode gravar cadastro — para ninguém usar isto como consulta de CPF.
CREATE OR REPLACE FUNCTION public.parties_doc_em_uso(_doc text, _exceto uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(code, left(coalesce(display_name, ''), 3) || '***')
    FROM parties
   WHERE public.has_capability(auth.uid(), 'registry.manage')
     AND doc_digits = _doc AND is_active AND id IS DISTINCT FROM _exceto
   ORDER BY created_at
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.parties_doc_em_uso(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parties_doc_em_uso(text, uuid) TO authenticated;

-- A trava roda no papel de quem grava (sem SECURITY DEFINER): direto pela tela
-- é `authenticated`; dentro de uma rotina do banco é o dono da rotina, e passa.
CREATE OR REPLACE FUNCTION public.parties_doc_unico()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE outro text;
BEGIN
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF NEW.doc_digits IS NULL OR length(NEW.doc_digits) NOT IN (11, 14) OR NOT coalesce(NEW.is_active, true) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.doc_digits IS NOT DISTINCT FROM OLD.doc_digits
     AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN
    RETURN NEW;
  END IF;
  outro := public.parties_doc_em_uso(NEW.doc_digits, NEW.id);
  IF outro IS NOT NULL THEN
    RAISE EXCEPTION 'Este documento já está cadastrado (%). Abra a ficha existente.', outro USING errcode = '23505';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zy_parties_doc_unico ON public.parties;
-- "zy_" roda depois de trg_parties_normalize (que calcula doc_digits) e antes do zz_ de privacidade
CREATE TRIGGER zy_parties_doc_unico
  BEFORE INSERT OR UPDATE OF doc, doc_digits, is_active ON public.parties
  FOR EACH ROW EXECUTE FUNCTION public.parties_doc_unico();

COMMENT ON FUNCTION public.parties_doc_unico() IS
  'Recusa, só na gravação direta pela tela, um segundo cadastro ativo com o mesmo CPF/CNPJ. Rotinas do banco não passam por aqui.';