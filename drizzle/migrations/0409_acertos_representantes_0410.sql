CREATE TABLE public.rep_acerto_tabelas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  vigente_de date NOT NULL UNIQUE,
  faixas jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rep_acerto_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  retencao_pct numeric(6,4) NOT NULL DEFAULT 0,
  retencao_desde date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rep_acertos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representante_party_id uuid NOT NULL REFERENCES public.parties(id),
  data date NOT NULL,
  praca text NOT NULL,
  responsavel_nome text,
  clientes_atendidas int, aberturas int, cortes int, nao_atendidas int,
  estoque_enviado_cents bigint, venda_bruta_cents bigint, venda_liquida_cents bigint, recebimento_cents bigint,
  total_pago_cents bigint,
  combustivel_cents bigint NOT NULL DEFAULT 0, hotel_cents bigint NOT NULL DEFAULT 0,
  alimentacao_cents bigint NOT NULL DEFAULT 0, outros_cents bigint NOT NULL DEFAULT 0,
  retido_cents bigint, desconto_pessoal_cents bigint NOT NULL DEFAULT 0,
  observacao text,
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','planilha')),
  excluido_em timestamptz, excluido_motivo text,
  criado_por uuid, atualizado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rep_acertos_unico ON public.rep_acertos (representante_party_id, data, upper(praca)) WHERE excluido_em IS NULL;
GRANT SELECT ON public.rep_acerto_tabelas, public.rep_acerto_config, public.rep_acertos TO authenticated;
GRANT ALL ON public.rep_acerto_tabelas, public.rep_acerto_config, public.rep_acertos TO service_role;
ALTER TABLE public.rep_acerto_tabelas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rep_acerto_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rep_acertos ENABLE ROW LEVEL SECURITY;
CREATE POLICY rep_acerto_tabelas_ler ON public.rep_acerto_tabelas FOR SELECT TO authenticated USING ((SELECT public.has_capability(auth.uid(), 'finance.view')));
CREATE POLICY rep_acerto_config_ler ON public.rep_acerto_config FOR SELECT TO authenticated USING ((SELECT public.has_capability(auth.uid(), 'finance.view')));
CREATE POLICY rep_acertos_ler ON public.rep_acertos FOR SELECT TO authenticated USING ((SELECT public.has_capability(auth.uid(), 'finance.view')));

INSERT INTO public.rep_acerto_tabelas (nome, vigente_de, faixas) VALUES
('Tabela 1 — jan a mai/2026', '2026-01-01', '[{"nome":"CRÍTICO","min":0,"pct":0.12},{"nome":"CRÍTICO 2","min":0.7501,"pct":0.13},{"nome":"MÉDIA","min":0.8001,"pct":0.14},{"nome":"BOM","min":0.8701,"pct":0.15},{"nome":"TOP","min":0.9001,"pct":0.16},{"nome":"EXCELENTE","min":0.95,"pct":0.17}]'),
('Tabela 2 — jun/2026', '2026-06-01', '[{"nome":"CRÍTICO","min":0,"pct":0.10},{"nome":"MÉDIA","min":0.8501,"pct":0.13},{"nome":"BOM","min":0.9001,"pct":0.14},{"nome":"TOP","min":0.9501,"pct":0.15},{"nome":"EXCELENTE","min":0.98,"pct":0.17}]'),
('Tabela 3 — jul a ago/2026', '2026-07-01', '[{"nome":"CRÍTICO","min":0,"pct":0.095},{"nome":"MÉDIA","min":0.8501,"pct":0.125},{"nome":"BOM","min":0.9001,"pct":0.135},{"nome":"TOP","min":0.9501,"pct":0.145},{"nome":"EXCELENTE","min":0.98,"pct":0.165}]'),
('Tabela 4 — desde 31/08/2026', '2026-08-31', '[{"nome":"CRÍTICO","min":0,"pct":0.09},{"nome":"MÉDIA","min":0.8501,"pct":0.12},{"nome":"BOM","min":0.9001,"pct":0.13},{"nome":"TOP","min":0.9501,"pct":0.14},{"nome":"EXCELENTE","min":0.98,"pct":0.16}]');
INSERT INTO public.rep_acerto_config (id, retencao_pct, retencao_desde) VALUES (true, 0.20, '2026-09-01');

INSERT INTO public.rep_acertos (representante_party_id, data, praca, responsavel_nome, clientes_atendidas, aberturas, cortes, nao_atendidas,
  estoque_enviado_cents, venda_bruta_cents, venda_liquida_cents, recebimento_cents, total_pago_cents,
  combustivel_cents, hotel_cents, alimentacao_cents, outros_cents, retido_cents, desconto_pessoal_cents, observacao, origem)
SELECT CASE v.r WHEN 'M' THEN '72a0a281-68e6-4846-81ca-716919b1d452'::uuid WHEN 'G' THEN 'f38ce2e8-6973-43e6-bccf-0d2cdc1acc4f'::uuid ELSE 'cb395a2e-8c08-4123-89d6-7dcb838ea373'::uuid END,
 v.d::date, v.p, v.resp, v.a, v.ab, v.co, v.na, v.est, v.vb, v.vl, v.rec, v.tp, v.cb, v.ht, v.al, v.ou, v.ret, v.dp, v.obs, 'planilha'
FROM (VALUES
('M','2026-01-05','TEODORO SAMPAIO',NULL::text,53,5,10,4,35292167,4108794,2561034,2760779,2692662,0,0,0,126047,0,0,NULL::text),
('M','2026-01-12','ASSIS',NULL,59,7,7,5,38070875,2966066,1879503,1667725,1608369,0,0,0,122902,0,0,NULL),
('M','2026-01-19','JAGUARIAIVA',NULL,56,5,9,0,34050505,3224209,2035761,1691683,1643524,0,0,0,121680,0,0,NULL),
('M','2026-01-26','PITANGA',NULL,55,5,6,2,36951653,3220489,2048026,1698433,1615704,0,0,0,115089,0,0,NULL),
('M','2026-02-02','TELEMACO BORBA',NULL,53,3,7,1,31756204,2738118,1759245,1611378,1591390,0,0,0,116462,0,0,NULL),
('M','2026-02-09','ROLANDIA/PRUDENTE',NULL,54,4,5,2,36275424,3468975,2176107,2135731,2115228,0,0,0,108424,0,0,NULL),
('M','2026-02-16','TEODORO SAMPAIO',NULL,56,7,6,2,29961115,2326182,1481656,1571025,1490135,0,0,0,112790,0,0,NULL),
('M','2026-02-23','ASSIS',NULL,65,9,5,3,39397191,2723991,1737922,1477851,1472476,0,0,0,114480,0,0,NULL),
('M','2026-03-02','JAGUARIAIVA',NULL,48,5,11,2,31527769,2022391,1301727,1196624,1189353,0,0,0,120503,0,0,NULL),
('M','2026-03-09','PITANGA',NULL,56,4,5,0,34509539,2785447,1754790,1454018,1435806,0,0,0,132002,0,0,NULL),
('M','2026-03-16','TELEMACO BORBA',NULL,47,2,9,0,30514973,1763037,1157420,996390,973371,0,0,0,108378,0,0,NULL),
('M','2026-03-23','ROLANDIA/PRUDENTE',NULL,56,7,5,2,32398259,2391504,1506766,1416303,1399928,0,0,0,110210,0,0,NULL),
('M','2026-03-30','TEODORO SAMPAIO',NULL,46,5,13,4,28528293,2777552,1751168,1422449,1306148,0,0,0,115372,0,0,NULL),
('M','2026-04-06','ASSIS',NULL,56,6,16,2,29745686,1861147,1198664,1578655,1568463,0,0,0,142330,0,75400,'1/6 R$754,00 IPHONE'),
('M','2026-04-13','JAGUARIAIVA',NULL,56,11,5,0,29419715,2040971,1336517,1275344,1240702,0,0,0,118555,0,0,NULL),
('M','2026-04-20','PITANGA',NULL,54,12,14,0,32127427,2392537,1545367,1426946,1393479,0,0,0,114800,0,0,NULL),
('M','2026-04-27','TELEMACO BORBA',NULL,44,7,10,0,27396956,1787676,1162385,1072561,1058789,0,0,0,108835,0,0,NULL),
('M','2026-05-04','ROLANDIA/PRUDENTE',NULL,52,10,15,1,35624446,3163261,1988760,1398296,1252308,0,0,0,40197,0,75400,'2/6 R$754,00 IPHONE'),
('M','2026-05-11','TEODORO SAMPAIO',NULL,49,8,5,4,29996388,3359753,2108697,2131441,2100644,0,0,0,101442,0,0,NULL),
('M','2026-05-18','ASSIS',NULL,59,14,13,0,30985133,1727296,1132958,1116593,1091858,0,0,0,106246,0,0,NULL),
('M','2026-05-25','JAGUARIAIVA',NULL,64,17,9,0,34265593,2509784,1631001,1276755,1262190,0,0,0,107159,0,0,NULL),
('M','2026-06-01','PITANGA',NULL,55,25,24,0,29023123,2385918,1538610,1390574,1383880,0,0,0,119253,0,75400,'3/6 R$754,00 IPHONE'),
('M','2026-06-08','TELEMACO BORBA',NULL,53,13,4,0,31109695,2072949,1361383,1375033,1356891,0,0,0,111034,0,0,NULL),
('M','2026-06-15','ROLANDIA/PRUDENTE',NULL,56,12,9,0,32373085,2759617,1726233,1475268,1450704,0,0,0,119051,0,0,NULL),
('M','2026-06-22','TEODORO SAMPAIO',NULL,59,10,4,0,31974780,3062693,1929384,1541635,1519327,0,0,0,116746,0,0,NULL),
('M','2026-06-29','ASSIS',NULL,58,16,15,2,26565918,1968455,1265144,1270907,1225323,0,0,0,135650,0,0,NULL),
('M','2026-07-06','JAGUARIAIVA',NULL,60,9,9,4,34049587,2339244,1522967,1619817,1602710,0,0,0,103837,0,75400,'4/6 R$754,00 IPHONE'),
('M','2026-07-13','PITANGA',NULL,59,14,10,0,32285564,3017166,1936166,1336829,1324038,0,0,0,105520,0,0,NULL),
('M','2026-07-20','TELEMACO BORBA',NULL,55,8,4,2,27727316,1824119,1200351,1117224,1112806,0,0,0,98207,0,0,NULL),
('M','2026-07-27','ROLANDIA/PRUDENTE',NULL,54,17,19,0,31489928,2775477,1756873,1583912,1579682,0,0,0,102825,0,0,NULL),
('M','2026-08-03','TEODORO SAMPAIO',NULL,56,7,7,3,33387149,2595944,1649202,1719191,1706677,0,0,0,135927,0,75400,'5/6 R$754,00 IPHONE'),
('M','2026-08-10','ASSIS',NULL,57,6,9,0,29683295,2383109,1519650,1734177,1725305,0,0,0,113082,0,0,NULL),
('M','2026-08-17','JAGUARIAIVA',NULL,56,8,9,2,30557588,1974359,1283346,1001686,992785,56302,29000,12675,0,0,35801,'DIFERENÇA DEVOLUÇÃO R$358,01'),
('M','2026-08-24','PITANGA',NULL,53,10,14,2,30711189,2646954,1747299,1668283,1610581,0,0,0,95400,0,0,NULL),
('M','2026-08-31','TELEMACO BORBA',NULL,52,16,11,2,25691452,1779082,1191344,1136855,1120853,0,0,0,115589,31832,75400,'6/6 R$754,00 IPHONE'),
('M','2026-09-07','ROLANDIA/PRUDENTE',NULL,47,9,18,0,30939984,3891291,2463625,2345436,2318206,0,0,0,76752,65672,0,NULL),
('M','2026-09-14','TEODORO SAMPAIO',NULL,52,9,12,5,29209235,2823374,1822968,1552592,1530955,0,0,0,99786,37262,0,NULL),
('M','2026-09-21','ASSIS',NULL,42,14,24,0,25653001,2463216,1615426,1424730,1376913,0,0,0,78500,34194,0,NULL),
('M','2026-09-28','JAGUARIAIVA',NULL,54,13,14,1,26480793,2289810,1530444,1004336,995434,0,0,0,94590,0,0,NULL),
('M','2026-10-05','PITANGA',NULL,45,12,18,1,16738979,2363490,1603298,1392519,1320399,0,0,0,108867,0,0,NULL),
('M','2026-10-12','TELEMACO BORBA',NULL,44,9,7,1,24775932,2535018,1693685,1709762,1707528,0,0,0,95791,0,0,NULL),
('M','2026-10-19','ROLANDIA/PRUDENTE',NULL,42,11,7,3,24580125,3014797,1919452,1464207,1422339,0,0,0,78684,0,0,NULL),
('M','2026-10-26','TEODORO SAMPAIO',NULL,50,9,9,0,30646468,3109831,2041925,1755170,1744320,0,0,0,105913,0,0,NULL),
('M','2026-11-02','ASSIS',NULL,40,12,7,4,23152156,2073639,1370354,1092757,1092682,0,0,0,100861,0,0,NULL),
('M','2026-11-09','JAGUARIAIVA',NULL,50,14,10,2,27968827,2888133,1921286,1799798,1794363,0,0,0,126334,0,0,NULL),
('M','2026-11-16','PITANGA',NULL,45,14,6,2,20534226,1586150,1101258,971973,958278,0,0,0,106440,0,0,NULL),
('G','2026-01-05','LOANDA',NULL,53,6,10,4,34168067,3349434,2087407,2170546,2151577,0,0,0,93985,0,0,NULL),
('G','2026-01-12','LONDRINA/MAUA',NULL,59,10,7,3,41360401,2993688,1898237,1819652,1803173,0,0,0,75074,0,0,NULL),
('G','2026-01-19','CORNELIO PROCOPIO',NULL,55,7,7,3,35703598,3794669,2392566,2226043,2202260,0,0,0,111548,0,0,NULL),
('G','2026-01-26','ARAPONGAS',NULL,54,7,7,3,37818081,3027102,1930396,1487426,1479831,0,0,0,62900,0,0,NULL),
('G','2026-02-02','OURINHOS',NULL,53,3,8,2,33025563,3029266,1905508,1930133,1926214,0,0,0,117400,0,0,NULL),
('G','2026-02-09','PRIMEIRO DE MAIO',NULL,49,4,9,2,27158507,2736628,1739733,1716160,1698329,0,0,0,105600,0,0,NULL),
('G','2026-02-16','LOANDA',NULL,47,3,7,6,30228150,2607918,1639831,1294086,1282616,0,0,0,162700,0,0,NULL),
('G','2026-02-23','LONDRINA/MAUA',NULL,55,5,8,4,31610237,1793517,1166895,1358953,1319223,0,0,0,74600,0,0,NULL),
('G','2026-03-02','CORNELIO PROCOPIO',NULL,54,4,4,4,35452868,2818842,1775649,1588931,1500448,0,0,0,128337,0,0,NULL),
('G','2026-03-09','ARAPONGAS',NULL,52,5,9,1,29974176,2242048,1449948,1593100,1593100,0,0,0,56500,0,0,NULL),
('G','2026-03-16','OURINHOS',NULL,52,10,12,1,32312112,2541912,1620284,1156057,1134342,0,0,0,136000,0,0,NULL),
('G','2026-03-23','PRIMEIRO DE MAIO',NULL,46,14,17,2,22958056,1546454,1019124,787776,773295,0,0,0,110800,0,0,NULL),
('G','2026-03-30','LOANDA',NULL,55,12,10,0,30510127,2258848,1435299,1243767,1233368,0,0,0,120900,0,0,NULL),
('G','2026-04-06','LONDRINA/MAUA',NULL,56,8,9,2,29624736,1626950,1083373,1050091,1050091,0,0,0,78597,0,0,NULL),
('G','2026-04-13','CORNELIO PROCOPIO',NULL,50,4,6,6,32977644,2499112,1589863,1516633,1515362,0,0,0,109549,0,0,NULL),
('G','2026-04-20','ARAPONGAS',NULL,50,10,7,6,26623200,1658240,1076865,952364,955170,0,0,0,80700,0,0,NULL),
('G','2026-04-27','OURINHOS',NULL,53,11,7,4,32793212,2228614,1424437,1328416,1321898,0,0,0,111820,0,0,NULL),
('G','2026-05-04','PRIMEIRO DE MAIO',NULL,47,12,12,1,26491385,2516623,1352633,1278878,1269800,0,0,0,89198,0,0,NULL),
('G','2026-05-11','LOANDA',NULL,50,5,9,1,31905810,2372178,1499162,1244126,1240554,0,0,0,123900,0,0,NULL),
('G','2026-05-18','LONDRINA/MAUA',NULL,56,10,10,2,26510956,1883840,1219391,903713,902183,0,0,0,70000,0,0,NULL),
('G','2026-05-25','CORNELIO PROCOPIO',NULL,60,15,8,3,33973438,2435078,1540144,1486996,1483580,0,0,0,122800,0,0,NULL),
('G','2026-06-01','ARAPONGAS',NULL,70,26,10,2,46647734,3832202,2422230,1348330,1328849,0,0,0,119300,0,0,NULL),
('G','2026-06-08','OURINHOS',NULL,58,11,7,3,32692140,2114280,1381259,1399887,1390914,0,0,0,138500,0,0,NULL),
('G','2026-06-15','PRIMEIRO DE MAIO',NULL,47,12,11,2,26060128,2035223,1308720,1270558,1265776,0,0,0,93300,0,0,NULL),
('G','2026-06-22','LOANDA',NULL,48,9,11,1,28660909,1699934,1087834,1127638,1115947,0,0,0,123259,0,0,NULL),
('G','2026-06-29','LONDRINA/MAUA',NULL,64,15,8,1,30612850,1841904,1201826,907644,850802,0,0,0,74393,0,0,NULL),
('G','2026-07-06','CORNELIO PROCOPIO',NULL,63,13,11,2,36329791,3822764,1924261,1779669,1772149,0,0,0,110100,0,0,NULL),
('G','2026-07-13','ARAPONGAS',NULL,66,8,11,3,36435634,2281657,1482435,876097,858518,0,0,0,68590,0,0,NULL),
('G','2026-07-20','OURINHOS',NULL,54,11,14,4,28623146,1774733,1143502,1067581,1067581,0,0,0,123400,0,0,NULL),
('G','2026-07-27','PRIMEIRO DE MAIO',NULL,47,5,7,0,25916757,1815347,1181070,895184,858368,0,0,0,87790,0,0,NULL),
('G','2026-08-03','LOANDA',NULL,54,15,10,0,27811736,1918688,1249792,1133531,1124847,0,0,0,118700,0,0,NULL),
('G','2026-08-10','LONDRINA/MAUA',NULL,57,11,14,5,25383697,1904954,1219558,1318475,1296724,0,0,0,78800,0,0,NULL),
('G','2026-08-17','CORNELIO PROCOPIO',NULL,59,9,8,2,35012172,2665782,1642547,1674766,1671977,0,0,0,138400,0,0,NULL),
('G','2026-08-24','ARAPONGAS',NULL,57,12,17,3,31749957,2474704,1574568,966083,933165,0,0,0,55958,0,29490,'PEÇAS DA CONFERENCIA'),
('G','2026-08-31','OURINHOS',NULL,56,13,13,1,26848842,1759090,1190204,1166654,1146909,0,0,0,111661,37333,0,NULL),
('G','2026-09-07','PRIMEIRO DE MAIO',NULL,49,6,9,2,26520022,2218533,1479736,1252877,1248342,0,0,0,75568,22552,0,NULL),
('G','2026-09-14','LOANDA & LONDRINA',NULL,90,42,16,3,46513110,3211912,2169510,1666790,1561005,0,0,0,178288,30002,0,NULL),
('G','2026-09-28','CORNELIO PROCOPIO',NULL,52,12,15,2,28625862,2378919,1585591,1439206,1439206,0,0,0,124137,37419,0,NULL),
('G','2026-10-05','ARAPONGAS',NULL,47,12,10,4,24415071,2286452,1506424,1324012,1304765,0,0,0,68714,0,0,NULL),
('G','2026-10-12','OURINHOS',NULL,48,8,8,2,24571468,1996566,1340931,1076030,1044545,0,0,0,123153,0,0,NULL),
('G','2026-10-19','PRIMEIRO DE MAIO',NULL,40,4,NULL,2,19616551,1907016,1239886,1162290,1149998,0,0,0,65104,0,0,NULL),
('G','2026-10-26','LOANDA',NULL,41,7,11,3,20760882,1884865,1248437,826682,828637,0,0,0,65326,0,0,NULL),
('G','2026-11-02','LONDRINA/MAUA',NULL,45,7,8,4,21716239,1418630,945877,820763,813570,0,0,0,10000,0,0,NULL),
('G','2026-11-09','CORNELIO PROCOPIO',NULL,55,14,6,4,26388927,2712524,1794258,1607589,1587441,0,0,0,0,0,0,NULL),
('G','2026-11-16','ARAPONGAS',NULL,54,8,4,4,22556820,1905491,1287555,993565,954221,0,0,0,0,0,0,NULL),
('D','2026-01-05','VENTANIA','MATHEUS VINICIUS',49,8,10,1,28636209,2508949,1600491,1528153,1528153,0,0,0,97100,0,0,NULL),
('D','2026-01-12','VOTUPORANGA','MATHEUS VINICIUS',41,6,6,2,24170927,2200060,1402102,1100875,1101220,0,0,0,109006,0,0,NULL),
('D','2026-01-19','IBAITI','MATHEUS VINICIUS',55,6,9,1,31727403,2808163,1761348,1208280,1214639,0,0,0,105050,0,0,NULL),
('D','2026-01-26','LINS/MARILIA','MATHEUS VINICIUS',48,2,4,0,25157629,1508731,966260,852817,851447,0,0,0,161577,0,0,NULL),
('D','2026-02-02','PONTA GROSSA','MATHEUS VINICIUS',46,6,6,2,30502785,2299585,1478787,1362883,1366182,0,0,0,166373,0,0,NULL),
('D','2026-02-09','CAMBE/LONDRINA','MATHEUS VINICIUS',50,2,5,3,31073114,4179823,2304808,1877910,1878307,0,0,0,83670,0,0,NULL),
('D','2026-02-16','VENTANIA','MATHEUS VINICIUS',45,4,6,3,19458996,956631,642558,685986,682966,0,0,0,95594,0,0,NULL),
('D','2026-02-23','VOTUPORANGA','MATHEUS VINICIUS',44,7,5,1,23442704,1449882,949647,880755,886202,0,0,0,205149,0,0,NULL),
('D','2026-03-02','IBAITI','MATHEUS VINICIUS',43,4,15,2,27219006,1768614,1143276,1119358,1119440,0,0,0,183054,0,0,NULL),
('D','2026-03-09','LINS/MARILIA','GUSTAVO PELEGRINI',43,10,13,2,22758159,913837,616900,519244,519244,0,0,0,76671,0,0,NULL),
('D','2026-03-16','PONTA GROSSA','GUSTAVO PELEGRINI',46,10,12,0,24130941,1168356,774640,742958,750864,0,0,0,90037,0,0,NULL),
('D','2026-03-23','CAMBE/LONDRINA','GUSTAVO PELEGRINI',47,6,10,2,29334316,2221745,1413038,953842,953842,0,0,0,105756,0,0,NULL),
('D','2026-03-30','VENTANIA','GUSTAVO PELEGRINI',52,13,8,1,20717675,1224444,822774,599183,599183,0,0,0,90100,0,0,NULL),
('D','2026-04-06','VOTUPORANGA','GUSTAVO PELEGRINI',40,10,13,2,18785979,1339742,872999,899936,904021,0,0,0,151530,0,0,NULL),
('D','2026-04-13','IBAITI','GUSTAVO PELEGRINI',29,7,17,6,18822277,1089298,710318,643307,643307,0,0,0,85093,0,0,NULL),
('D','2026-04-20','LINS/MARILIA','GUSTAVO PELEGRINI',27,5,21,2,11268232,626932,411323,352941,352941,0,0,0,108879,0,0,NULL),
('D','2026-04-27','PONTA GROSSA','GUSTAVO PELEGRINI',48,13,8,3,24021478,1601543,1035504,887069,887069,0,0,0,140015,0,0,NULL),
('D','2026-05-04','CAMBE/LONDRINA','GUSTAVO PELEGRINI',45,9,12,1,24988998,2251073,1416577,1106035,1103908,0,0,0,75610,0,0,NULL),
('D','2026-05-11','VENTANIA','GUSTAVO PELEGRINI',37,6,16,6,23473989,1262943,851853,854304,854304,0,0,0,89390,0,0,NULL),
('D','2026-05-18','VOTUPORANGA','GUSTAVO PELEGRINI',44,10,8,0,23859267,1548134,1015737,865956,865956,0,0,0,130604,0,0,NULL),
('D','2026-05-25','IBAITI','GUSTAVO PELEGRINI',37,9,5,2,15411361,952550,636949,632243,632243,0,0,0,99558,0,0,NULL),
('D','2026-06-01','LINS/MARILIA','DANIEL MACIEL',40,17,5,1,19151384,1941317,1233671,766991,766991,0,0,0,85391,0,0,NULL),
('D','2026-06-08','PONTA GROSSA','EVERTON AP.',51,11,10,1,25267551,1567763,1029725,1091077,1091077,0,0,0,62745,0,0,NULL),
('D','2026-06-15','CAMBE/LONDRINA','EVERTON AP.',43,8,8,3,24607848,1519364,984314,799500,799500,0,0,0,100835,0,0,NULL),
('D','2026-06-22','VENTANIA','EVERTON AP.',41,6,5,3,20667670,1553067,1002562,786912,786912,0,0,0,147000,0,0,NULL),
('D','2026-06-29','VOTUPORANGA','EVERTON AP.',46,10,7,1,20011843,1598062,1041185,650481,650481,0,0,0,164570,0,0,NULL),
('D','2026-07-06','IBAITI','EVERTON AP.',38,8,5,4,17484530,1124195,713065,665221,645852,0,0,0,141456,0,0,NULL),
('D','2026-07-13','LINS/MARILIA','EVERTON AP.',31,3,13,0,17419388,1042157,691266,593928,603340,0,0,0,54500,0,0,NULL),
('D','2026-07-20','PONTA GROSSA','EVERTON AP.',48,8,11,1,21851900,1271707,819364,677982,650188,0,0,0,159000,0,0,NULL),
('D','2026-07-27','CAMBE/LONDRINA','EVERTON AP.',40,6,9,3,21748253,1585724,1006006,822071,697011,0,0,0,101900,0,0,NULL),
('D','2026-08-03','VENTANIA','EVERTON AP.',51,13,6,0,27326335,1599795,1055812,984707,939082,0,0,0,139303,0,50000,'31/07/2026 R$200,00 DINHEIRO + 03/08/2026 PIX R$300,00'),
('D','2026-08-10','VOTUPORANGA','EVERTON AP.',28,7,20,3,19248032,1808611,1126529,786316,785895,79609,41600,35450,8500,0,130000,'10/08/2026 R$400,00 BRENDA R$400,00 NEUZA AP. R$400,00 WELITON VAL. R$100,00 EVERTON'),
('D','2026-08-17','IBAITI','EVERTON AP.',41,12,13,3,21765837,1424692,939184,748605,748538,0,0,0,123117,0,20500,'22/08/2026 R$105,00 BEBIDA - 22/08/2026 R$100,00 BEBIDA'),
('D','2026-08-24','LINS-MARILIA','EVERTON AP.',45,11,3,0,24927037,1810229,1165860,944243,899605,0,0,0,148497,0,32008,'30/08/2026 R$200,00 ida para casa da mãe + DIFERENÇA CONFERENCIA PEÇAS R$120,08'),
('D','2026-08-31','PONTA GROSSA','EVERTON AP.',34,8,13,3,18393210,1000193,680275,844106,843381,0,0,0,126227,0,130000,'04/09/2026 R$400,00 BRENDA R$400,00 NEUZA AP. R$400,00 WELITON R$100,00 CHOPP'),
('D','2026-09-07','CAMBÉ/IBIPORA','EVERTON AP.',38,2,6,3,23120448,1840361,1220497,1130238,1121740,0,0,0,113436,0,171014,'11/09/2026 GASTOS EXTRAS NO CARTÃO DEBITO R$807,76 - PEÇAS VENDIDAS R$402,38 - NEUZA R$500,00'),
('D','2026-09-14','VENTANIA','EVERTON AP.',55,7,7,2,30843792,1761443,1180435,1050045,999303,0,0,0,146300,0,282703,'PEGOU DINHEIRO PARA JOGO + 1019,27 GASTOS DE SEXTA ATÉ DOMINGO'),
('D','2026-09-21','VOTUPORANGA','EVERTON AP.',27,11,9,0,16160273,1528505,1006996,786440,787342,0,0,0,139931,0,0,NULL),
('D','2026-09-28','IBAITI','EVERTON AP.',44,12,10,1,21592110,1591729,1075561,896514,755883,0,0,0,63870,0,40500,'pessoal 125 e 280'),
('D','2026-10-05','LINS-MARILIA','DANIEL MACIEL',40,3,10,5,19646790,1762395,1156204,1126562,1126562,0,0,0,71743,0,0,NULL),
('D','2026-10-12','PONTA GROSSA','DANIEL MACIEL',31,6,9,3,15595001,1075277,741404,968418,968418,0,0,0,21757,0,0,NULL),
('D','2026-10-19','CAMBÉ/IBIPORA','DANIEL MACIEL',27,NULL,NULL,NULL,17804293,1395087,918005,885533,885533,0,0,0,0,0,0,NULL),
('D','2026-10-26','VENTANIA','DANIEL MACIEL',53,NULL,NULL,NULL,17614717,986610,716386,703360,703360,0,0,0,0,0,0,NULL)
) v(r,d,p,resp,a,ab,co,na,est,vb,vl,rec,tp,cb,ht,al,ou,ret,dp,obs);

CREATE OR REPLACE FUNCTION public.rep_acerto_pode_editar(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_role(_uid, 'master') OR public.has_role(_uid, 'diretoria') OR public.has_role(_uid, 'financeiro');
$$;
REVOKE ALL ON FUNCTION public.rep_acerto_pode_editar(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rep_acerto_pode_editar(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_acerto_calculo(a public.rep_acertos) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t record; f jsonb; v_pct_rec numeric; v_faixa text; v_com numeric := 0; v_comissao bigint; v_gastos bigint; v_dif bigint; v_ret bigint; cfg record;
BEGIN
  SELECT * INTO t FROM rep_acerto_tabelas WHERE vigente_de <= a.data ORDER BY vigente_de DESC LIMIT 1;
  v_pct_rec := CASE WHEN coalesce(a.venda_liquida_cents,0) > 0 THEN a.recebimento_cents::numeric / a.venda_liquida_cents END;
  IF t.id IS NOT NULL AND v_pct_rec IS NOT NULL THEN
    FOR f IN SELECT x FROM jsonb_array_elements(t.faixas) x ORDER BY (x->>'min')::numeric LOOP
      IF v_pct_rec >= (f->>'min')::numeric THEN v_faixa := f->>'nome'; v_com := (f->>'pct')::numeric; END IF;
    END LOOP;
  END IF;
  v_comissao := round(v_com * coalesce(a.recebimento_cents,0));
  v_gastos := a.combustivel_cents + a.hotel_cents + a.alimentacao_cents + a.outros_cents;
  v_dif := coalesce(a.recebimento_cents,0) - coalesce(a.total_pago_cents,0);
  SELECT * INTO cfg FROM rep_acerto_config WHERE id;
  v_ret := coalesce(a.retido_cents, CASE WHEN cfg.retencao_desde IS NOT NULL AND a.data >= cfg.retencao_desde THEN round(v_comissao * cfg.retencao_pct) ELSE 0 END);
  RETURN jsonb_build_object(
    'tabela', t.nome, 'pct_recebimento', v_pct_rec, 'faixa', v_faixa, 'pct_comissao', v_com,
    'comissao_cents', v_comissao, 'gastos_cents', v_gastos, 'diferenca_cents', v_dif, 'retido_calc_cents', v_ret,
    'retido_automatico', a.retido_cents IS NULL,
    'carteira', coalesce(a.clientes_atendidas,0) + coalesce(a.nao_atendidas,0),
    'aproveitamento', CASE WHEN coalesce(a.estoque_enviado_cents,0) > 0 THEN a.venda_bruta_cents::numeric / a.estoque_enviado_cents END,
    'ticket_bruto_cents', CASE WHEN coalesce(a.clientes_atendidas,0) > 0 THEN round(a.venda_bruta_cents::numeric / a.clientes_atendidas) END,
    'ticket_liquido_cents', CASE WHEN coalesce(a.clientes_atendidas,0) > 0 THEN round(a.venda_liquida_cents::numeric / a.clientes_atendidas) END,
    'livre_cents', v_comissao - v_dif - v_ret - a.desconto_pessoal_cents);
END $$;
REVOKE ALL ON FUNCTION public.rep_acerto_calculo(public.rep_acertos) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rep_acerto_calculo(public.rep_acertos) TO service_role;

CREATE OR REPLACE FUNCTION public.rep_acertos_lista(_rep uuid DEFAULT NULL, _ano int DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_capability(auth.uid(), 'finance.view') THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object(
    'pode_editar', public.rep_acerto_pode_editar(auth.uid()),
    'representantes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.display_name, 'codigo', p.code) ORDER BY p.display_name)
        FROM parties p WHERE EXISTS (SELECT 1 FROM party_roles r WHERE r.party_id = p.id AND r.role = 'representante') AND p.status <> 'desligado'), '[]'::jsonb),
    'linhas', coalesce((SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('rep_nome', p.display_name) || public.rep_acerto_calculo(a) ORDER BY a.data DESC, a.praca)
        FROM rep_acertos a JOIN parties p ON p.id = a.representante_party_id
       WHERE a.excluido_em IS NULL AND (_rep IS NULL OR a.representante_party_id = _rep)
         AND (_ano IS NULL OR extract(year FROM a.data) = _ano)), '[]'::jsonb),
    'tabelas', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.vigente_de) FROM rep_acerto_tabelas t),
    'config', (SELECT to_jsonb(c) FROM rep_acerto_config c WHERE id));
END $$;
REVOKE ALL ON FUNCTION public.rep_acertos_lista(uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rep_acertos_lista(uuid, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_acerto_salvar(_d jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid := nullif(_d->>'id','')::uuid; v_antes jsonb; v_rep uuid := nullif(_d->>'representante_party_id','')::uuid;
BEGIN
  IF NOT public.rep_acerto_pode_editar(auth.uid()) THEN RAISE EXCEPTION 'Só Master, Diretoria ou Financeiro lançam acertos de representantes.' USING errcode = '42501'; END IF;
  IF v_rep IS NULL OR NOT EXISTS (SELECT 1 FROM party_roles WHERE party_id = v_rep AND role = 'representante') THEN RAISE EXCEPTION 'Escolha o representante.'; END IF;
  IF nullif(_d->>'data','') IS NULL THEN RAISE EXCEPTION 'Informe a data do acerto.'; END IF;
  IF nullif(btrim(_d->>'praca'),'') IS NULL THEN RAISE EXCEPTION 'Informe a praça.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(_d) e WHERE e.key LIKE '%\_cents' AND jsonb_typeof(e.value) = 'number' AND (e.value::text)::numeric < 0) THEN
    RAISE EXCEPTION 'Valores não podem ser negativos.';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO rep_acertos (representante_party_id, data, praca, criado_por, atualizado_por) VALUES (v_rep, (_d->>'data')::date, btrim(_d->>'praca'), auth.uid(), auth.uid()) RETURNING id INTO v_id;
  ELSE
    SELECT to_jsonb(a) INTO v_antes FROM rep_acertos a WHERE id = v_id AND excluido_em IS NULL FOR UPDATE;
    IF v_antes IS NULL THEN RAISE EXCEPTION 'Acerto não encontrado.'; END IF;
  END IF;
  UPDATE rep_acertos SET
    representante_party_id = v_rep, data = (_d->>'data')::date, praca = btrim(_d->>'praca'),
    responsavel_nome = nullif(btrim(_d->>'responsavel_nome'),''),
    clientes_atendidas = nullif(_d->>'clientes_atendidas','')::int, aberturas = nullif(_d->>'aberturas','')::int,
    cortes = nullif(_d->>'cortes','')::int, nao_atendidas = nullif(_d->>'nao_atendidas','')::int,
    estoque_enviado_cents = nullif(_d->>'estoque_enviado_cents','')::bigint, venda_bruta_cents = nullif(_d->>'venda_bruta_cents','')::bigint,
    venda_liquida_cents = nullif(_d->>'venda_liquida_cents','')::bigint, recebimento_cents = nullif(_d->>'recebimento_cents','')::bigint,
    total_pago_cents = nullif(_d->>'total_pago_cents','')::bigint,
    combustivel_cents = coalesce(nullif(_d->>'combustivel_cents','')::bigint,0), hotel_cents = coalesce(nullif(_d->>'hotel_cents','')::bigint,0),
    alimentacao_cents = coalesce(nullif(_d->>'alimentacao_cents','')::bigint,0), outros_cents = coalesce(nullif(_d->>'outros_cents','')::bigint,0),
    retido_cents = nullif(_d->>'retido_cents','')::bigint, desconto_pessoal_cents = coalesce(nullif(_d->>'desconto_pessoal_cents','')::bigint,0),
    observacao = nullif(btrim(_d->>'observacao'),''), atualizado_por = auth.uid(), updated_at = now()
  WHERE id = v_id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), CASE WHEN v_antes IS NULL THEN 'rep_acerto.criado' ELSE 'rep_acerto.alterado' END, 'rep_acertos', v_id::text,
          jsonb_build_object('antes', v_antes, 'depois', (SELECT to_jsonb(a) FROM rep_acertos a WHERE id = v_id)));
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe acerto deste representante nesta data e praça.';
END $$;
REVOKE ALL ON FUNCTION public.rep_acerto_salvar(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rep_acerto_salvar(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_acerto_excluir(_id uuid, _motivo text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.rep_acerto_pode_editar(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  IF length(btrim(coalesce(_motivo,''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo (fica na auditoria).'; END IF;
  UPDATE rep_acertos SET excluido_em = now(), excluido_motivo = btrim(_motivo), atualizado_por = auth.uid() WHERE id = _id AND excluido_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acerto não encontrado.'; END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload) VALUES (auth.uid(), 'rep_acerto.excluido', 'rep_acertos', _id::text, jsonb_build_object('motivo', _motivo));
END $$;
REVOKE ALL ON FUNCTION public.rep_acerto_excluir(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rep_acerto_excluir(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_acerto_operacao(_rep uuid, _data date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_capability(auth.uid(), 'finance.view') THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'remessa', r.numero, 'praca', p.nome, 'data_acerto', r.data_acerto,
      'maletas', (SELECT count(*) FROM kit_cycles k WHERE k.remessa_id = r.id AND k.status <> 'cancelada'),
      'estoque_enviado_cents', (SELECT coalesce(sum(k.reference_total_cents),0) FROM kit_cycles k WHERE k.remessa_id = r.id AND k.status <> 'cancelada'),
      'baixas_fechadas', (SELECT count(*) FROM kit_pre_baixas b WHERE b.remessa_id = r.id AND b.status <> 'aberta'),
      'vendido_cents', (SELECT coalesce(sum(coalesce(b.vendido_final_cents, b.total_vendido_cents)),0) FROM kit_pre_baixas b WHERE b.remessa_id = r.id AND b.status <> 'aberta'),
      'sem_maleta', (SELECT count(*) FROM remessa_informacoes i WHERE i.remessa_id = r.id AND i.cycle_id IS NULL AND i.sem_maleta_motivo IS NOT NULL)
    ) ORDER BY r.data_acerto)
    FROM remessas r JOIN cob_pracas p ON p.id = r.praca_id
    WHERE r.representante_party_id = _rep AND r.status <> 'cancelada' AND r.data_acerto BETWEEN _data - 6 AND _data + 6), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.rep_acerto_operacao(uuid, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rep_acerto_operacao(uuid, date) TO authenticated, service_role;
