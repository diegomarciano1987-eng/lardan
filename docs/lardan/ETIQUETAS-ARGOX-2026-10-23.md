# Etiquetas Argox — 23/10/2026

## Entrega
- Opção A: impressão pelo diálogo do navegador. Não instala ponte local, não enumera impressoras e não imprime silenciosamente. Cada computador escolhe sua Argox no diálogo.
- Etiqueta 25 × 12 mm, três pistas. Papel base 75 × 12 mm, acrescido dos espaços e margens informados por estação. Espaços não fornecidos ficam em zero para calibração; zero não é uma medida confirmada do rolo.
- Quantidades revisáveis por variante; pista inicial 1/2/3 e preenchimento da última linha sem cópias extras. Ajustes persistidos somente neste navegador.
- Ações na ficha de produto salvo, variantes, lista Produtos, saldos e detalhe Estoque, ficha da remessa, ficha da maleta e documentos após montagem.
- Barcode e referência são campos distintos existentes. Nunca cria código, sequencial, SKU, entrada de estoque ou cobrança. Referência ausente é apresentada como ausente; na linha inferior da etiqueta usa o próprio barcode quando não há referência.
- Code 128 gerado por biblioteca, sem diminuir barras abaixo de um ponto nominal a 203 DPI; códigos que excedem a área são bloqueados, não truncados. O exemplo LBRP0295-005499 tem 178 módulos mais 20 de área silenciosa, aproximadamente 24,78 mm; margem muito apertada exige impressão física e leitura antes de lote.

## Provas
- `bunx vitest run tests/cadastros/etiquetas.test.ts`: 6 aprovados, zero falhas. Três pistas, preservação integral do exemplo, pista inicial, referência separada, código ausente/largo e quantidade fracionada rejeitados; conteúdo escapado.
- Navegador na conta autorizada: lista exibiu 20 ações. Busca por brinco abriu produto cadastrado “BR DOU BRINCO FESTA (CRAVEJADO) ROSÉ IMPERIAL”, barcode 17942. Folha aberta: uma linha, um SVG, barcode integral 17942; mensagem honesta sobre envio/cancelamento. Nenhum produto alterado.
- Estoque: 20 ações de etiquetas verificadas na lista; zero erros de navegador no percurso.
- Capturas locais: `/tmp/browser/etiquetas/dialog.png` e `/tmp/browser/etiquetas/print.png`.

## Limitações
- Não houve conexão com uma Argox física, teste do leitor ou seleção de impressora Windows nesta bancada. Escala 100%, papel personalizado, zero margens e cabeçalhos desativados precisam ser conferidos na estação.
- Não declara impressão concluída quando abre a janela; navegador não confirma papel impresso.
- Não publicou. Carteira e vínculos do pacote anterior continuam aguardando aprovação.