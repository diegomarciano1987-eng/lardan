ALTER TABLE public.assinatura_modelos DROP CONSTRAINT IF EXISTS assinatura_modelos_tipo_check;
ALTER TABLE public.assinatura_modelos ADD CONSTRAINT assinatura_modelos_tipo_check CHECK (tipo = ANY (ARRAY['contrato','promissoria','confissao']));
ALTER TABLE public.assinaturas_digitais DROP CONSTRAINT IF EXISTS assinaturas_digitais_tipo_check;
ALTER TABLE public.assinaturas_digitais ADD CONSTRAINT assinaturas_digitais_tipo_check CHECK (tipo = ANY (ARRAY['contrato','promissoria','avulso','confissao']));
ALTER TABLE public.assinaturas_digitais ADD COLUMN IF NOT EXISTS simulacao_id uuid REFERENCES public.cob_simulacoes(id);
CREATE UNIQUE INDEX IF NOT EXISTS assinaturas_confissao_pendente_unica ON public.assinaturas_digitais(simulacao_id) WHERE status='pendente' AND tipo='confissao';

INSERT INTO public.assinatura_modelos(tipo, titulo, texto, revisado)
SELECT 'confissao', 'Termo de confissão de dívida — {{nome}}',
'# TERMO DE CONFISSÃO DE DÍVIDA E ACORDO DE PAGAMENTO

**MINUTA — revisar com o jurídico antes do uso.**

**DEVEDORA:** {{nome}}, CPF {{cpf}}, residente em {{endereco}}, {{bairro}}, {{cidade}}, CEP {{cep}}, WhatsApp {{whatsapp}}.

**CREDORA:** LARDAN Semijoias.

## 1. Da dívida
A DEVEDORA reconhece e confessa, de forma irrevogável e irretratável, dever à CREDORA a quantia de **{{valor}}** ({{valor_extenso}}), referente às seguintes obrigações em aberto:

{{dividas}}

## 2. Do acordo de pagamento
A dívida será paga da seguinte forma:

{{plano}}

## 3. Do inadimplemento
O não pagamento de qualquer parcela na data combinada torna vencido todo o saldo, acrescido de multa e juros, autorizando a cobrança judicial deste título, que é reconhecido pelas partes como título executivo extrajudicial.

## 4. Da assinatura eletrônica
As partes reconhecem a validade da assinatura eletrônica deste termo, realizada com validação por código, selfie e foto do documento da DEVEDORA.

{{cidade}}, {{hoje_extenso}}.
', false
WHERE NOT EXISTS (SELECT 1 FROM public.assinatura_modelos WHERE tipo='confissao');

CREATE OR REPLACE FUNCTION public.assinatura_registrar(_d jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE novo uuid;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  IF nullif(_d->>'substitui', '') IS NOT NULL THEN
    UPDATE assinaturas_digitais SET status = 'cancelado', atualizado_em = now()
     WHERE id = (_d->>'substitui')::uuid AND status = 'pendente';
  END IF;
  INSERT INTO assinaturas_digitais (ambiente, tipo, party_id, cycle_id, representante_party_id, doc_token, signer_token, sign_url,
                                    status, titulo, texto_hash, valor_cents, enviado_whatsapp, erro, criado_por, simulacao_id)
  VALUES (_d->>'ambiente', _d->>'tipo', (_d->>'party_id')::uuid, nullif(_d->>'cycle_id', '')::uuid, nullif(_d->>'rep', '')::uuid,
          _d->>'doc_token', _d->>'signer_token', _d->>'sign_url', coalesce(_d->>'status', 'pendente'), _d->>'titulo', _d->>'texto_hash',
          nullif(_d->>'valor_cents', '')::bigint, coalesce((_d->>'whatsapp')::boolean, false), _d->>'erro', nullif(_d->>'ator', '')::uuid,
          nullif(_d->>'simulacao_id','')::uuid)
  RETURNING id INTO novo;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (nullif(_d->>'ator', '')::uuid, 'assinatura.enviada', 'assinaturas_digitais', novo::text,
          jsonb_build_object('tipo', _d->>'tipo', 'party_id', _d->>'party_id', 'cycle_id', _d->>'cycle_id', 'simulacao_id', _d->>'simulacao_id', 'ambiente', _d->>'ambiente'));
  RETURN jsonb_build_object('id', novo);
END $function$;

CREATE OR REPLACE FUNCTION public.cob_confissao_dados(_simulacao uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s record; p record; a record; m record; zap text; mail text; pend jsonb := '[]'; plano text; dividas text; pendente jsonb;
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança' USING errcode='42501'; END IF;
  SELECT * INTO s FROM cob_simulacoes WHERE id=_simulacao;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acordo não encontrado.'; END IF;
  IF s.status NOT IN ('simulada','aguardando_entrada','efetivada') THEN RAISE EXCEPTION 'Acordo cancelado ou excluído não gera termo.'; END IF;
  IF jsonb_array_length(coalesce(s.plano,'[]')) = 0 THEN RAISE EXCEPTION 'Acordo sem parcelas.'; END IF;
  SELECT * INTO m FROM assinatura_modelos WHERE tipo='confissao';
  SELECT * INTO p FROM parties WHERE id=s.party_id;
  SELECT * INTO a FROM party_addresses WHERE party_id=s.party_id ORDER BY is_primary DESC, created_at LIMIT 1;
  SELECT regexp_replace(value,'\D','','g') INTO zap FROM contact_points WHERE party_id=s.party_id AND kind='whatsapp' ORDER BY is_primary DESC, created_at LIMIT 1;
  SELECT value INTO mail FROM contact_points WHERE party_id=s.party_id AND kind='email' ORDER BY is_primary DESC, created_at LIMIT 1;
  IF zap IS NULL OR length(zap) < 10 THEN pend := pend || '["WhatsApp"]'; END IF;
  IF p.doc_digits IS NULL OR length(p.doc_digits) <> 11 THEN pend := pend || '["CPF"]'; END IF;
  IF a.city IS NULL THEN pend := pend || '["Endereço"]'; END IF;
  SELECT string_agg('- Parcela '||coalesce(x.v->>'numero', x.ord::text)||': '||to_char((x.v->>'valor_cents')::numeric/100,'FM"R$ "999G999G990D00')||' com vencimento em '||to_char((x.v->>'data')::date,'DD/MM/YYYY'), E'\n' ORDER BY x.ord)
    INTO plano FROM jsonb_array_elements(s.plano) WITH ORDINALITY x(v, ord);
  IF coalesce(s.entrada_cents,0) > 0 THEN
    plano := '- Entrada: '||to_char(s.entrada_cents::numeric/100,'FM"R$ "999G999G990D00')||coalesce(' em '||to_char(s.entrada_data,'DD/MM/YYYY'),'')||E'\n'||coalesce(plano,'');
  END IF;
  SELECT string_agg('- Vencimento '||to_char(c.vencimento,'DD/MM/YYYY')||': '||to_char(c.saldo_cents::numeric/100,'FM"R$ "999G999G990D00'), E'\n' ORDER BY c.vencimento)
    INTO dividas FROM public.cob_parcelas_abertas() c WHERE c.installment_id = ANY(s.installment_ids);
  SELECT to_jsonb(x) INTO pendente FROM (SELECT id, sign_url FROM assinaturas_digitais WHERE simulacao_id=_simulacao AND tipo='confissao' AND status='pendente' ORDER BY criado_em DESC LIMIT 1) x;
  RETURN jsonb_build_object(
    'party_id', s.party_id, 'pendente', pendente,
    'modelo', jsonb_build_object('titulo', m.titulo, 'texto', m.texto, 'revisado', m.revisado),
    'pendencias', pend,
    'signer', jsonb_build_object('nome', p.display_name, 'cpf', p.doc_digits, 'whatsapp', zap, 'email', mail),
    'campos', jsonb_build_object('nome', p.display_name,
      'cpf', CASE WHEN length(p.doc_digits)=11 THEN regexp_replace(p.doc_digits,'^(\d{3})(\d{3})(\d{3})(\d{2})$','\1.\2.\3-\4') ELSE coalesce(p.doc_digits,'') END,
      'codigo', p.code, 'endereco', btrim(concat_ws(', ', a.street, a.street_number)), 'bairro', coalesce(a.district,''),
      'cidade', coalesce(a.city||'/'||a.uf,''), 'cep', coalesce(regexp_replace(a.postal_code,'^(\d{5})(\d{3})$','\1-\2'),''),
      'whatsapp', coalesce(zap,''), 'representante','', 'praca','', 'maleta','', 'remessa','',
      'valor_cents', s.total_cents, 'plano', coalesce(plano,''), 'dividas', coalesce(dividas,'- Conforme parcelas em aberto na data do acordo')));
END $$;
REVOKE ALL ON FUNCTION public.cob_confissao_dados(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cob_confissao_dados(uuid) TO authenticated;