# Provas 0266 — teste interno do Daniel (08/11/2026)

Migrações: 0266 (busca, numeração, conferência ZapSign), 0267 e 0268 (correções da busca pegas pela bancada isolada antes de chegar ao Daniel).
Agendamento novo: `zapsign-conferir-pendentes`, a cada 10 minutos, rota `/api/public/zapsign/conferir` (recusa sem a chave: HTTP 401).

| Item | Prova |
|---|---|
| 1. Contrato assinado | ZapSign (leitura): contrato "guilherme" `signed` em 08/11 13:10 UTC, sistema mostrava `pendente`. Conferência rodada: `{conferidos: 8, assinados: 1, erros: 0}`; banco agora `assinado`, assinado_em 13:10:02, cópia do PDF guardada. App do Daniel (390×844): selo "Contrato assinado" e "Assinado em 08/11/2026 · baixar assinado". |
| 2. Busca da maleta | App do Daniel, MAL-00492 (remessa 927): busca "pelegrini" → "guilherme pelegrini · Ibiporã — Candidata". Nada foi repassado. |
| 3. Etiqueta | ABERTURA 4 REM 926 (MAL-00363, maleta_numero 11): PPLZ/PPLB gerados sem o 11; remessa 926 mantida. Não impresso na Argox. |
| 4. Romaneio | kit_pedido_dados real da ABERTURA 02 / remessa 926: cabeçalho "Remessa 00926 · Abertura 02", cartão "MALETA DE ABERTURA 02". Não impresso. |
| 5. Tela cheia | "Nova candidata" e "Fazer abertura": fluxo direto no body, 390×844 cobertos, 7/7 pontos tocáveis dentro do fluxo, fundo travado; ao fechar, rolagem volta. Nenhuma candidata salva. |
| 6. Tela da remessa | 925: 39× MALETA 01 + ABERTURA 01–11; 926: 41× MALETA 01 + ABERTURA 01–14. |

Testes: 8 novos isolados (21 asserções) + 9 unitários; regressão 92 testes em 8 baterias (maletas, perdidas, assinaturas, ZapSign, representante, transferência, pedido, segurança).

Observação: o banco aceita uma maleta por consultora em cada remessa (trava `kit_cycles_remessa_consultora_uq`); por isso hoje todas aparecem como MALETA 01. "MALETA 02" aparece sozinho se essa regra mudar.
