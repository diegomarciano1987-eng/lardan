-- 0128 — Nomes das situações das maletas iguais aos da tela do SmallData.
--
-- A tela de remessas do SmallData mostra 7 situações: 1 Rem Aberta Cliente, 2 Rem Alterada,
-- 3 Rem Novo Kit, 4 Rem Conferida, 5 Rem Importada, 6 Rem com Acerto, 7 Rem Fechada.
-- Os códigos do registro (T_REM_CLI_STATUS) são os mesmos de 1 a 7 — o 6 e o 7 caem no dia
-- da cobrança e do fechamento do acerto. O 8 e o 9 são etapas internas DEPOIS do fechamento
-- (não aparecem na tela) e o 11 é a remessa perdida.
-- "Na rua" continua sendo só a 4 (Rem Conferida). Só troca nome que ainda está como a 0127
-- deixou: o que o Master já tiver ajustado fica.

UPDATE public.legado_maleta_situacoes s
   SET nome = v.novo, atualizado_em = now()
  FROM (VALUES
    (1, 'Remessa aberta cliente', '1 - Rem Aberta Cliente'),
    (2, 'Remessa alterada', '2 - Rem Alterada'),
    (3, 'Remessa novo kit', '3 - Rem Novo Kit'),
    (4, 'Saída conferida (na rua)', '4 - Rem Conferida'),
    (5, 'Retorno recebido', '5 - Rem Importada'),
    (6, 'Retorno em contagem', '6 - Rem com Acerto'),
    (7, 'Retorno contado', '7 - Rem Fechada'),
    (8, 'Em acerto', '7 - Rem Fechada (etapa 8, depois do fechamento)'),
    (9, 'Finalizada', '7 - Rem Fechada (etapa 9, depois do fechamento)'),
    (11, 'Remessa perdida', 'Remessa perdida')
  ) AS v(codigo, antigo, novo)
 WHERE s.codigo = v.codigo AND s.nome = v.antigo;