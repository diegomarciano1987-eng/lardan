# Etiquetas, representante e produtividade pessoal — 23/10/2026

## Resultado e limites
Implementados os cinco ajustes. Interface não publicada. A migração aditiva 0149 foi aplicada na base compartilhada; não foram criadas maletas, realizadas bipagens nem alterados vínculos reais.

## 1. Contraste das etiquetas
O botão compartilhado agora define texto escuro explicitamente, sem herdar o texto claro do topo. Conferidos Produtos e cockpit na sessão real da colaboradora. Capturas: `/tmp/browser/etiquetas-v3/products.png`, `cockpit.png` e `contrast.png`.

## 2. Representante na remessa
Filtro e abertura de remessa usam diretamente o vínculo autorizado, evitando reaproveitar opções entre perfis. A sessão de Ketllin mostrou Daniel de Freitas Maciel nos dois lugares; seu nome aparece somente como identidade da conta no topo. Nenhuma remessa foi aberta. Captura: `nova-remessa.png`.
Não foi reproduzido um registro que troque consultora por representante: a lista operacional está sem dados nesta carteira. Histórico mantém nomes e relações originais; não foram reescritos como se fossem Daniel.

## 3. Identificação da maleta
Code 128 codifica o `kits.code` existente, por exemplo MAL-00274, sem nova numeração. A impressão usa o mesmo rolo e calibração da estação. O campo de leitura aceita o código e preserva tokens QR antigos. A rotina retorna somente ciclo visível e exige permissão de consulta. Teste isolado confirma abertura e bloqueio fora da carteira.

## 4. Visão Geral pessoal
`/admin` oferece somente trabalho da colaboradora, sem consultas aos totais administrativos. O login continua abrindo Maletas. Conferida a tela real com estado honesto “Sem dados de bipagem”; não há histórico de autoria inventado.
Operações novas usam `montagem_item_operar`: autenticação, carteira, permissão de alterar, incremento sob bloqueio transacional, identificador de operação e registro imutável. Repetição não soma novamente. Seleção manual e retirada são separadas de bipagem. Dia e período são calculados em America/Sao_Paulo.

## 5. Etiquetas por peça
Adicionado botão de impressora ao lado de foto, descrição e quantidade na montagem e conferência. Abre inicialmente uma etiqueta, com quantidade ajustável. O foco periódico do leitor é suspenso enquanto o diálogo de etiquetas está aberto e retorna ao campo ao fechar. Impressão não muda composição ou estoque.

## Testes executados
- Bancada recriada do zero com todas as migrações: **440 testes isolados, zero falhas**.
- Etiquetas: **8 testes, zero falhas**; incluem rolo, códigos integrais, maleta, limites e calibração.
- Seis testes pessoais verificam repetição, autoria, concorrência, resumo, separação manual, escopo e somente leitura.
- Sinal automático de compilação: build OK.
- Telas reais: Produtos, cockpit, Visão Geral, filtro de remessa e Nova remessa.

## Pendências que impedem afirmar “tela a tela concluído”
Não existe ciclo operacional acessível na carteira Daniel da sessão usada. Portanto montagem, conferência, documentos e o fluxo visual bipagem → resumo preenchido não foram exercitados com dados reais. A bancada comprovou as rotinas, mas não substitui essas telas. Não criamos maletas fictícias nem alteramos permissões para contornar isso.
Impressão física e leitura na Argox dependem da estação. Abertura de janela não significa impressão confirmada. Nada publicado.