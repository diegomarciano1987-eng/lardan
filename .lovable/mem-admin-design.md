---
name: Painel robusto premium
description: Regra visual do admin LARDAN Cloud — nunca texto fino/apagado, cards imponentes, tipografia pesada
type: design
---
O painel administrativo deve ser imponente e legível, sem perder o charme premium.
Why: usuário rejeitou cards/letras "apagados" e com leitura difícil — exigiu upgrade em TODAS as telas, inclusive futuras.
How to apply: usar os tokens fortes de src/styles.css (ledger-text #171512, ledger-muted #57514a, line #cfc5b7, bronze #7c5540), utility ledger-panel com sombra presente, regras `.admin-scope` (todo texto base em font-weight 500, headings 600), Jost/Cormorant com pesos 600-700 carregados. Nunca usar text-muted-foreground/text-foreground crus nem tabelas shadcn sem restyle nas telas do painel.
