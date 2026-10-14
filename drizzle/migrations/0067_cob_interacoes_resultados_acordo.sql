ALTER TABLE public.cob_interacoes DROP CONSTRAINT cob_interacoes_resultado_check;

ALTER TABLE public.cob_interacoes ADD CONSTRAINT cob_interacoes_resultado_check CHECK (resultado IN ('sucesso','sem_sucesso','nao_atendeu','recado','outro','simulacao','efetivada','cancelada','suspensa','liberada')) NOT VALID;

COMMENT ON COLUMN public.cob_interacoes.resultado IS 'sucesso/sem_sucesso/nao_atendeu/recado/outro: contato. simulacao/efetivada/cancelada: acordo. suspensa/liberada: pausa do caso.';