-- 0244 — Respostas do Daniel (05/11/2026, noite).
--  1. Correios: quem libera maleta para consultora com débito vencido é o Daniel (diretoria) ou o
--     Master, sempre com motivo registrado.
--  2. Correios: consultora sem e-mail → a reversa usa o e-mail da Lardan (lardansemijoias@gmail.com).
--  3. Recebido no Asaas sem título (mesa → "Criar título novo e baixar") nasce na 3.1.1 Revenda de
--     Mercadorias Produção Própria, como as faturas de venda (0234).
-- As funções são ajustadas por troca de trecho, com conferência. Idempotente: se o trecho novo já
-- estiver no lugar (banco que já recebeu esta mudança), a migração não faz nada; se nem o trecho
-- novo nem o antigo existirem, ela para com erro (nada muda pela metade).

do $$
declare d text; novo text;
begin
  d := pg_get_functiondef('public.correios_envio_abrir(uuid, text, text, text, bigint, jsonb, uuid, text)'::regprocedure);
  if position('Só o Daniel (diretoria) ou o Master libera envio com débito vencido.' in d) = 0 then
    novo := replace(d,
      $a$    if _ator is null or not public.has_role(_ator, 'master') then
      raise exception 'Só o Master libera envio com débito vencido.';$a$,
      $b$    if _ator is null or not (public.has_role(_ator, 'master') or public.has_role(_ator, 'diretoria')) then
      raise exception 'Só o Daniel (diretoria) ou o Master libera envio com débito vencido.';$b$);
    if novo = d then raise exception '0244: trecho da liberação de débito não encontrado em correios_envio_abrir'; end if;
    execute novo;
  end if;

  d := pg_get_functiondef('public.correios_maleta_dados(uuid, text)'::regprocedure);
  if position('lardansemijoias@gmail.com' in d) = 0 then
    novo := replace(d,
      $a$    if coalesce(rem->>'email', '') = '' then pend := array_append(pend, 'consultora sem e-mail (a reversa dos Correios exige)'); end if;$a$,
      $b$    -- Daniel, 05/11: sem e-mail da consultora, vai o da Lardan (a reversa dos Correios exige e-mail)
    if coalesce(rem->>'email', '') = '' then rem := jsonb_set(rem, '{email}', to_jsonb('lardansemijoias@gmail.com'::text)); end if;$b$);
    if novo = d then raise exception '0244: trecho do e-mail da reversa não encontrado em correios_maleta_dados'; end if;
    execute novo;
  end if;
end $$;

-- 3. Título criado na mesa Asaas nasce na 3.1.1 quando ninguém classificou.
CREATE OR REPLACE FUNCTION public.fin_titulo_revenda_padrao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.chart_account_id IS NULL AND NEW.direction::text = 'receivable'
     AND (NEW.origem IN ('consultora','pdv','representante')
          OR (NEW.origem = 'conciliacao' AND NEW.sistema_origem = 'asaas')) THEN
    SELECT id INTO NEW.chart_account_id FROM chart_of_accounts WHERE codigo = '3.1.1' LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fin_titulo_revenda_padrao() FROM public, anon, authenticated;
