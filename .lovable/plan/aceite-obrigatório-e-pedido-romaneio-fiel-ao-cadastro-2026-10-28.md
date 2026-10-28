# Aceite obrigatório e pedido/romaneio fiel ao cadastro

## Objetivo
Exigir a conferência e o recebimento da maleta antes de liberar o aplicativo da consultora; corrigir as referências; permitir ao Daniel salvar os textos; e configurar o telefone de pedidos por colaboradora. Entregar provas de funcionamento, não somente imagens de botões.

Preservar os textos padrão do Daniel, preços registrados na maleta, quantidades, estoque, comissões, Pix oficial, assinatura exigida, auditoria e permissões. Nenhuma alteração nas páginas públicas ou no visual aprovado fora das telas envolvidas.

## Diagnóstico comprovado
- A coluna do PDF está intitulada Referência, mas a consulta considera apenas a referência da variante e o código legado. A ficha da variante diz explicitamente: **“Vazio = usa a referência do produto”**; esse segundo caminho falta no pedido.
- Na consulta atual há **17.325 variantes**, **nenhuma com referência própria preenchida**, e **17.257 vinculadas a produtos com referência válida**. Portanto, trocar somente o título da coluna não corrigiu o problema.
- O campo solicitado é **Código de referência (etiqueta)**. Código de barras e código legado são campos diferentes.
- Os textos estão em **Remessas → Configurar impressora → Textos e Pix**, também acessíveis em **Configurações → Pedido de consignação**. Hoje o salvamento exige Master na tela e no serviço de gravação. **O papel efetivo do Daniel ainda não foi comprovado**; a afirmação anterior de que ele seria apenas diretoria não será usada como diagnóstico.
- O aceite atual fica dentro de Minha maleta. O recebimento físico e a conferência são etapas distintas; a confirmação oficial exige maleta recebida e entregue à consultora. Quando há assinatura exigida, gerar/enviar o termo não equivale a aceitar.
- O telefone do representante já tem uma origem separada do telefone de pedidos: cadastro do representante vinculado à remessa, com alternativa no vínculo da maleta. Isso ainda precisa ser comparado com o PDF real.

## 1. Referências corretas, sem zeros nem códigos de barras substitutos
- Aplicar a mesma regra da ficha/etiqueta: referência específica da variante, quando válida; caso contrário, **referência do produto**.
- Preservar o código como texto, inclusive zeros à esquerda de uma referência válida. Não transformar referência em número.
- Não usar SKU/código de barras ou código legado como se fossem referência. Quando faltar realmente, mostrar **“Sem referência”**, sem fabricar código; identificar as exceções para revisão.
- Reutilizar essa origem na lista de conferência da consultora, além do pedido/romaneio.
- Não renumerar produtos nem preencher em massa o catálogo: corrigir a leitura e a apresentação.

**Prova exigida:** gerar pelo botão Romaneio uma maleta real já existente, comparar **cada linha** com o campo da ficha/etiqueta e entregar o PDF e uma tabela de conferência sem dados sensíveis desnecessários. Testar variante sem referência, variante com referência própria, referência com zeros à esquerda e peça realmente sem referência.

## 2. Salvamento dos textos pelo Daniel
- Reproduzir o erro na sessão correta e registrar a mensagem que impede o salvamento.
- Conferir as permissões efetivas da conta antes de alterar qualquer regra.
- Se já for Master, corrigir a falha da tela/sessão sem ampliar acesso. Se faltar autorização, habilitar somente a edição dos textos e contatos do pedido para o perfil autorizado do Daniel, com validação protegida e auditoria; não conceder Master nem liberar a todas as colaboradoras.
- Manter as regras independentes de reajuste, comissões, Pix oficial, MFA e exigência de pré-baixa. A permissão de editar textos não autoriza essas ações.
- Manter o conteúdo atual do Daniel; salvar apenas os campos efetivamente alterados, com erro claro e sem perder o texto digitado.

**Prova exigida:** entrar como Daniel, editar, clicar Salvar, fechar, recarregar e abrir novamente; conferir o valor persistido e o próximo PDF. Testar em cópia isolada com os mesmos dados/permissões; não substituir textos reais por frases de teste na operação. Confirmar também que uma conta não autorizada continua impedida de gravar.

## 3. Aba Por colaboradora em Configurar impressora
Local: **Remessas → Configurar impressora → Por colaboradora**.

- Listar as colaboradoras reais autorizadas, com identificação inequívoca e um **Telefone para pedidos** por conta.
- Mostrar o telefone já salvo, permitir configurar/remover a exceção e exibir qual será o número efetivo.
- Ao a colaboradora entrar e emitir o pedido/romaneio, usar o telefone configurado para **o login dela**. Sem exceção, manter o telefone padrão do Daniel; não inventar telefone nem puxar o de outra colaboradora.
- A personalização altera somente o telefone de pedidos. Endereço da empresa, e-mail, garantia, pagamento e demais textos continuam no padrão do Daniel.
- Vincular a configuração à identidade da conta, não ao nome, ao navegador ou ao computador compartilhado. Trocar o login deve trocar o telefone sem reutilizar o número da sessão anterior.
- **“Montado por” permanece vinculado ao histórico de montagem**, não muda para quem simplesmente imprimiu. O telefone por login e a autoria da montagem são informações distintas.
- A administração dessas exceções segue autorização específica e auditada; a colaboradora só lê a configuração necessária à própria impressão.

**Prova exigida:** dois logins de colaboradoras com números diferentes em ambiente isolado, emissão pelo botão real, comparação do número impresso e troca de sessão no mesmo navegador; terceira conta sem exceção deve usar o padrão. Recarregar e repetir para provar persistência.

## 4. Aceite obrigatório no aplicativo, celular e desktop
- Ao abrir qualquer aba do aplicativo, detectar as maletas LARDAN atribuídas à própria consultora e ainda pendentes de recebimento/conferência. Nunca mostrar maletas em montagem nem registros de outra pessoa.
- Exibir um painel obrigatório, integrado ao estilo claro/escuro existente, antes de permitir usar Início, clientes, pedidos, vendas e demais áreas operacionais.
- Apresentar código da maleta, remessa, quantidade e valor total; peças agrupadas por categoria com **referência da etiqueta**, descrição, foto existente, quantidade, preço unitário registrado e total. Sem imagens inventadas.
- No celular, usar lista legível e rolagem confortável; no desktop, tabela organizada. Botões não podem cobrir as últimas peças.
- Distinguir os estados: **a caminho**, **confirmar recebimento**, **conferir peças**, **assinatura pendente** e **aceite concluído**. Expedição não será registrada automaticamente como entrega.
- Usar as ações oficiais para confirmar a entrega e conferir todas as peças; permitir apontar falta/defeito com motivo, sem forçar aceite integral falso.
- Sem assinatura exigida, o clique de confirmação registra o aceite oficial e libera somente depois da resposta bem-sucedida e da releitura do estado salvo.
- Com assinatura exigida, o clique prepara/envia o termo; manter a tela de pendência até a assinatura validada, arquivo armazenado e finalização oficial. Não anunciar aceite concluído ao apenas enviar o termo.
- Erro de consulta/gravação não libera o aplicativo nem perde a conferência. Prevenir clique duplo; atualizar após retorno da assinatura e ao reabrir o aplicativo.
- Se houver mais de uma pendência, apresentar todas e liberar quando as pendências obrigatórias estiverem resolvidas. Ajuda e Sair continuam disponíveis para não aprisionar a usuária.
- Além da tela, validar as ações protegidas que poderiam permitir operar uma maleta não aceita por acesso direto; preservar os bloqueios oficiais e a propriedade dos dados.

**Prova exigida:** em conta autenticada e maleta de teste no ambiente isolado, abrir outra aba, comprovar o bloqueio, ler a lista, **clicar de verdade**, verificar o aceite gravado e operar pelo aplicativo liberado; recarregar e confirmar que não volta a exigir o mesmo aceite. Testar também divergência, tentativa por outra consultora, clique duplo, erro e múltiplas pendências. Não aceitar uma maleta real em nome da consultora para produzir prova.

## 5. Conferência de todas as informações personalizadas
Entregar uma matriz **Campo → origem → valor no PDF → resultado**, cobrindo:
- Referência, descrição, categoria, quantidade, preço unitário e total de cada peça.
- Nome/código da consultora, endereço, cidade/UF e WhatsApp do cadastro correspondente.
- Representante correto da remessa, nome, praça e telefone real do cadastro; contato WhatsApp preferencial, sem substituir pelo telefone de pedidos.
- Número da remessa, código da maleta, acerto e prazo de postagem somente quando envio por correio.
- Montado por, conforme histórico registrado; telefone de pedidos conforme login e exceção configurada.
- Textos padrão do Daniel, totais por categoria, total geral, comissão vigente e QR Pix oficial sem valor fixo.

Quando faltar algum dado, registrar a ausência; não corrigir cadastros silenciosamente nem expor CPF completo nos relatórios de prova.

## Execução e critérios de entrega
1. Preservar uma cópia dos textos atuais e conferir dados/permissões; preparar cenário isolado sem criar HOMOLOG na produção.
2. Corrigir referência e salvamento, depois personalização de telefone, depois bloqueio de aceite. Conferir cada etapa antes da seguinte.
3. Rodar os testes existentes afetados e novos testes de regras concretas, autorização, assinatura e idempotência.
4. Verificar no navegador celular e desktop, claro e escuro; screenshots comprovam aparência, **persistência e releitura comprovam funcionamento**.
5. Gerar PDF real pelo botão do sistema e conferir todas as folhas A4: margens, colunas, referências, contatos, totais e QR decodificado. Não usar um PDF montado à parte como prova do botão.
6. Entregar relatório por item, PDFs e capturas, separando **comprovado**, **não comprovado** e **dependente de ação externa**. A impressão física depende das impressoras da estação; a assinatura externa só será declarada comprovada com retorno real do provedor.
7. Informar exatamente onde configurar e como usar; mudanças nas telas do site publicado dependem de publicação explícita. Não publicar automaticamente.

## Detalhes técnicos e segurança
- Ajustar `kit_pedido_dados` para a referência efetiva variante → produto; remover o fallback para SKU em `pedido-consignacao.ts` e atualizar a documentação hoje inconsistente.
- Configuração aditiva por `user_id` da colaboradora, com grants/RLS e gravação protegida/auditada; resolver o telefone efetivo no servidor com a identidade autenticada, sem confiar em um identificador enviado pela tela.
- Centralizar o bloqueio no contêiner do app e reutilizar o recebimento/conferência existente em `consultora.tsx`. Preservar `kit_aceitar`, o trigger de assinatura e `kit_assinatura_finalizar`.
- Cobrir assinatura ligada/desligada e finalização com evidência em testes isolados. Não executar testes que gravem na base compartilhada.
- Nenhuma mudança em dinheiro, estoque, identificação de Pix ou permissões gerais para resolver apresentação e contato.