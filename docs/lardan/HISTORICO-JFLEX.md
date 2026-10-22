# Histórico do JFLEX no Lardan Cloud

Fonte: extração somente leitura do banco SISPR.FDB (Firebird 2.5.7) em 22/10/2026. Período: remessa nº 3 (07/11/2023) a nº 921 (21/10/2026).

## O que entra (migração 0112, tabelas `legado_*`)

| Arquivo | Linhas | Conteúdo |
|---|---:|---|
| pracas.csv | 53 | praças; código = `cob_pracas.codigo` |
| representantes.csv | 13 | representantes |
| consultoras.csv | 5.314 | consultoras (clientes do JFLEX, `codcli`) com CPF, endereço e IBGE |
| produtos.csv | 17.139 | produtos, categoria e subcategoria, preço de venda |
| remessas.csv | 462 | remessas, praça, representante, emissão, vencimento |
| maletas.csv | 28.635 | cada maleta: enviado, devolvido, defeito, valores de varejo, notas |
| maleta_categorias.csv | 175.224 | maleta × categoria |
| maleta_vendidos.csv | 123.100 | peças vendidas por maleta (remessas fechadas) |
| notas.csv | 73.969 | NF-e série 2 (sem XML) |
| acertos_praca.csv | 392 | encerramentos de praça |

Os CSV têm dados pessoais e **não ficam no repositório**: o Master envia pela tela de importação.

## Regras

- Nenhuma pessoa é criada. Ligação: código antigo (`party_codigos_legados`, sistema `cliente`) → CPF de uma única pessoa → manual (auditado).
- Só leitura sobre a operação: nada em maletas, estoque, pedidos, financeiro ou fiscal.
- Venda só conta em maleta com acerto (remessa fechada e data de fechamento). Maleta aberta: venda desconhecida.
- Valores das maletas em varejo; a nota fiscal saiu a **1/3** desse valor (100% das 73 mil notas conferidas).
- Numeração de remessa: o Lardan continua depois do maior número usado (Lardan ou JFLEX). Hoje: JFLEX em 921. Enquanto o JFLEX estiver emitindo, criar remessa no Lardan só depois de definir o dia da virada.

## Números de referência (remessas fechadas)

- 1,63 milhão de peças enviadas, 114 mil vendidas: giro de 7,0%.
- Giro por categoria (rede): tornozeleira 9,2%, pulseira 8,4%, anel 7,9%, brinco 6,7%, colar 6,7%, conjunto 6,0%.
- Brinco é 63% das peças enviadas.

## Roteiro fiscal observado (`fiscal_roteiro_referencia`)

| Operação | Natureza | CFOP PR / fora | Tipo | Observação |
|---|---|---|---|---|
| Remessa | REM/CONSIG. | 5917 / 6917 | saída | texto: `----- REMESSA: n KIT: k -----` |
| Devolução | DEVOLUCAO REMESSA | 1918 / 2918 | entrada (finalidade 4) | referencia a NF de remessa |
| Venda | VENDA CONSIGNADO | 5114 / 6114 | saída | "simples faturamento", referencia a NF de remessa |
| Perda | PERDA DE PRODUTOS | 5927 / 6949 | saída | 6949 fora do PR: confirmar |

Todas: Simples Nacional (CRT 1), CSOSN 102, PIS/COFINS 07, NCM 7117.19.00, origem 0, UND, frete 9.
Série 2; última nota do JFLEX: nº 73.963 (22/10/2026). Houve 6 números repetidos no JFLEX (rejeição de duplicidade).
