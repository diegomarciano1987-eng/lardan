# Cancelamento autorizado das sete maletas de teste

Executado em 16/10/2026 às 22:53 UTC após autorização de Diego Marciano.

| Maleta | Peças devolvidas | Destino |
|---|---:|---|
| MAL-00265 | 0 | Sem peças na maleta |
| MAL-00269 | 32 | DEP-01 — Depósito Principal |
| MAL-00270 | 0 | Sem peças na maleta |
| MAL-00271 | 4 | Seu depósito original HOMOLOG-VIT-1791583974179 |
| MAL-00272 | 4 | Seu depósito original HOMOLOG-VIT-1791583992510 |
| MAL-00273 | 4 | Seu depósito original HOMOLOG-VIT-1791584009757 |
| MAL-00274 | 4 | Seu depósito original HOMOLOG-VIT-1791584023785 |

Resultado conferido por leitura posterior: sete ciclos cancelados e kits desativados;
zero peças restantes nos locais dessas maletas; 48 peças devolvidas em 40 transferências
oficiais, sem aumentar o estoque global. Os dois ciclos em montagem estavam no depósito:
o saldo do depósito não foi transferido indevidamente.

Sete registros individuais em `audit_logs`, com estados anteriores de ciclos, kits,
saldos e transferências, e comprovante de lote `diego-cancelar-sete-20261016`.
Não foram apagados pedidos, títulos financeiros, catálogo, fotos ou históricos.
Os depósitos sintéticos continuam separados do depósito real: suas 16 peças não foram
introduzidas no DEP-01.

Validação: 33 testes isolados aprovados (28 de movimentações existentes + cinco de
cancelamento, prévia, atomicidade, restrição de acesso e repetição).
Tela `/admin/maletas` conferida com sessão do solicitante: Remessas vazia e totais zerados.
Operação de dados já aplicada à base compartilhada; nenhuma publicação foi realizada.

Recuperação: não reabrir ciclos manualmente. Os estados anteriores e IDs das transferências
estão preservados para eventual restauração aprovada com transferências inversas auditadas.