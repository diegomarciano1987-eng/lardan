-- Forma explícita para TED/DOC: não confundir com boleto ou depósito.
INSERT INTO public.payment_methods(codigo,nome,is_active)
SELECT 'transferencia_bancaria','Transferência bancária',true
WHERE NOT EXISTS(SELECT 1 FROM public.payment_methods WHERE codigo='transferencia_bancaria');