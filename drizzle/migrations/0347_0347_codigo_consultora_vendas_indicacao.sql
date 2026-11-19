-- 0347: código da consultora junto do nome na Central de vendas (últimas vendas) e no painel de indicação.
-- Só acrescenta campos de leitura; permissões e valores não mudam.
DO $mig$
DECLARE def text; novo text;
BEGIN
  SELECT pg_get_functiondef('public.central_vendas(date,date)'::regprocedure) INTO def;
  novo := replace(def, $a$'data', created_at, 'consultora', consultora,$a$, $a$'data', created_at, 'consultora', consultora, 'consultora_codigo', consultora_codigo,$a$);
  IF novo = def THEN RAISE EXCEPTION '0347: central_vendas diferente do esperado'; END IF;
  EXECUTE novo;

  SELECT pg_get_functiondef('public.indicacao_painel_admin()'::regprocedure) INTO def;
  novo := replace(def, $a$'nome', coalesce(p.display_name,p.legal_name), 'codigo', c.referral_code,$a$,
                       $a$'nome', coalesce(p.display_name,p.legal_name), 'consultora_codigo', p.code, 'codigo', c.referral_code,$a$);
  novo := replace(novo, $a$'madrinha', (SELECT coalesce(s.display_name,s.legal_name) FROM public.parties s WHERE s.id = c.sponsor_party_id),$a$,
                       $a$'madrinha', (SELECT coalesce(s.display_name,s.legal_name) FROM public.parties s WHERE s.id = c.sponsor_party_id),
        'madrinha_codigo', (SELECT s.code FROM public.parties s WHERE s.id = c.sponsor_party_id),$a$);
  novo := replace(novo, $a$'indicada', coalesce(i.display_name,i.legal_name),$a$,
                       $a$'indicada', coalesce(i.display_name,i.legal_name), 'madrinha_codigo', s.code, 'indicada_codigo', i.code,$a$);
  IF position('consultora_codigo' in novo) = 0 OR position($a$'indicada_codigo', i.code$a$ in novo) = 0 OR position($a$'madrinha_codigo', (SELECT s.code$a$ in novo) = 0 THEN
    RAISE EXCEPTION '0347: indicacao_painel_admin diferente do esperado';
  END IF;
  EXECUTE novo;
END $mig$;