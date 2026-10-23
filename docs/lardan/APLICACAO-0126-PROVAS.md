# 0126 — provas da reclassificação (23/10/2026)
- Prévia aprovada por Diego; aplicado `produto_reclassificar(true)` (só campos vazios, divergentes não corrigidos).
- Lote: `reclass-20261023-112619` (audit_logs catalogo.reclassificacao).
- Registros no lote: banho_tipo 10.444; category_id 16.980; categoria_criada 5; subcategorias limpas 0.
- Categorias criadas em rascunho: Berloque 44, Broche 17, Conjunto 281, Piercing 178, Pingente 219.
- Sem categoria restantes: 18. Banho vazio restante: 6.578 (6.546 sem banho na descrição + 32 indecisos).
- Custos: 16.986 com custo, 0 recalculados pelo banho (nenhum custo alterado). Publicados: 0.
- "Bracelete Essenza" (divergente) permaneceu em Pulseiras.
- Desfazer: select public.produto_reclassificacao_desfazer('reclass-20261023-112619');
