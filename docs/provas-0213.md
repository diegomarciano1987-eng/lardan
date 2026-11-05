# Pacote 0213 — provas (05/11/2026)

## Aplicação
- Patch compatível, sem conflito. SQL aplicado pela ferramenta e definição de venda_forma lida novamente no banco para confirmar.
- Rótulos de Central de vendas e Vendidos atualizados. Prioridade da cobrança Lardan preservada; fallback pela forma combinada.
- Dois ajustes sobre o pacote: novos botões usam Button; ações da foto ampliada quebram linha no celular sem esconder o nome.
- Teste novo do pacote usa guarda explícita em vez de nova asserção não-nula. Acrescentados 12 testes concretos de classificação.

## Testes executados
- Banco local descartável em 127.0.0.1:55433, sem dados ou credenciais da operação. 451 migrações e 4 pendências aplicadas.
- `tests/isolado/vitrine-compra.test.ts` e `tests/isolado/venda-forma.test.ts`: **18 aprovados, 0 falhas, 51 assertions**.
- `tests/vitrine/links-whatsapp.test.ts` e `tests/vitrine/whatsapp-estudio.test.ts`: **9 aprovados**.
- Cobrem Pix/crédito/débito/dinheiro/a prazo combinados, prioridade Pix/cartão/boleto Lardan, fallback honesto; compra, reserva, expiração, entrega e isolamento por consultora.

## Telas com dados reais, sem escrita
- Vitrine `/larissalardan`: 38 botões Comprar; clicar na peça Anel Coração Delicado abre Finalizar compra com 1 unidade e R$49,90.
- Comprar na foto ampliada abre o mesmo formulário, mantendo 1 unidade sem duplicar.
- Computador 1280×1800 e celular 390×844. Cartão selecionado com aria-pressed=true. Sem transbordamento horizontal; foto e ambos os botões visíveis no celular.
- `/admin`, sessão da própria conta Diego: Central de vendas carregou R$3.297,10, 18 vendas e 8 consultoras; nenhuma exceção de execução no navegador.
- Capturas locais: `/tmp/browser/pacote-0213/01-pecas-desktop.png` a `06-central-desktop.png`. Capturas são temporárias; resultados acima registrados no projeto.
- Último sinal disponível: build OK em 05/11/2026 17:03:37 UTC.

## Limitações
- Não publicada. A classificação somente de leitura já mudou no banco único; os novos botões chegam ao site após publicação aprovada.
- Nenhuma cobrança real, nenhum Pix pago, nenhuma compra fictícia criada na operação. O formulário real e as rotinas isoladas foram testados, não um pagamento real ponta a ponta no Asaas.
- Não reproduzidos os 589 testes citados pelo autor; executados somente os arquivos indicados acima.
- Prévia do Estúdio conserva a condição `!previa`; não testada por clique nesta execução. Vendidos validado via rotina no banco isolado, não pela tela de uma consultora real.