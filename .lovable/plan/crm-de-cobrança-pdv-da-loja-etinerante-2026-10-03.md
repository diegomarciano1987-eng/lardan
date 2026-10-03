# CRM de Cobrança + PDV da LOJA ETINERANTE

O documento pede um resumo do que dá para reaproveitar antes de começar. Ele está abaixo, junto com a ordem de entrega. Cada etapa só termina quando o sistema continua funcionando inteiro. Nada vai para o site oficial sem a sua aprovação.

## O que já existe e será reaproveitado
- **Módulos Cobrança e PDV Loja** já estão no menu como "em breve". Vão ser ativados, cada um com os seus próprios papéis de acesso.
- **CRM de Candidaturas** (Kanban, lista, agenda, indicadores, filtros guardados no endereço, ficha individual): serve de modelo visual. Os registros dos dois CRMs ficam separados.
- **Financeiro oficial** (títulos, parcelas, baixas, estornos, auditoria): continua sendo a única fonte dos valores devidos e recebidos. A Cobrança só lê esses dados e registra o atendimento.
- **Cadastro único de pessoas**: devedoras e clientes finais usam esse cadastro. A cliente final ganha o papel "cliente", sem virar consultora.
- **Estoque** (saldo por local, reservas, leitor de código de barras da entrada de maleta): o PDV usa as mesmas rotinas. O local **LOJA ETINERANTE** já existe e será ligado pelo código interno dele. **Hoje ele está com saldo zero.**
- **Asaas** (emissão, webhook, baixa automática já pronta na prévia): o PDV reaproveita tudo isso. Falta só buscar o QR Code Pix de verdade.

## Etapa 1 — CRM de Cobrança
- Carteira por devedora com indicadores clicáveis: vencido, devedoras, ações de hoje e atrasadas, promessas vencendo e promessas descumpridas.
- Lista, Kanban, Agenda e BI, com filtros guardados.
- Etapas do Kanban: Novo atraso → Em contato → Em negociação → Promessa → Acompanhamento. Arrastar um cartão nunca mexe no financeiro.
- Ficha da devedora com Resumo, Títulos e parcelas, Linha do tempo, Negociações e promessas, Agenda e Dados.
- Ações rápidas: registrar ligação, abrir WhatsApp, registrar negociação, registrar promessa, pedir desconto e agendar retorno. Abrir o WhatsApp fica registrado só como "contato aberto", nunca como mensagem enviada.
- Promessas avaliadas pelo que foi realmente recebido nas parcelas. O mesmo pagamento não conta para duas promessas.
- Desconto e renegociação: nesta etapa ficam como proposta e pedido de aprovação. O efeito no financeiro só acontece pela rotina oficial, e a tela mostra isso com clareza.
- Régua D+1, D+3, D+7 e D+15, rodando todo dia no servidor. Ela cria tarefas internas sem duplicar e sem enviar mensagens para fora. Para quando a parcela é quitada ou fica em pausa por promessa, e volta se a promessa for descumprida.
- Negativação só manual, com autorização registrada.
- BI com os critérios do documento escritos na tela. Cada número abre a lista de registros que o compõem. Quem não tem representante ou região aparece como "Não informado".
- A equipe de cobrança não acessa contas a pagar, contas bancárias nem configurações do financeiro.

## Etapa 2 — Base do PDV (unidade, acessos, caixa)
- A unidade fica ligada a 4 coisas: o local LOJA ETINERANTE, a empresa responsável, a conta de recebimento e a conta Asaas.
- Entrada própria em `/pdv/login` e ambiente `/pdv`, separado do administrativo. Login individual para cada pessoa, com três papéis: operadora, supervisora e gestão. As permissões são conferidas no servidor e no banco, por unidade.
- Caixa por terminal: abertura com fundo inicial, sangria, suprimento e fechamento. No fechamento: dinheiro esperado, dinheiro contado e diferença com justificativa, mais o resumo de Pix e cartão e os pagamentos pendentes.

## Etapa 3 — Frente de venda
- Uma única tela com cliente, busca/leitor e carrinho fixo do lado. Botões grandes, atalhos e tela cheia, pensada para notebook e tablet.
- Leitor USB com Enter. Bipar de novo aumenta a quantidade. Código ambíguo pede escolha. Código inválido ou sem saldo na loja mostra um aviso.
- Preço autorizado para o canal loja. Nunca calculado a partir do custo, e o produto não precisa estar publicado no site.
- Cadastro rápido da cliente sem perder o carrinho. CPF validado. Telefone parecido sugere revisão e nunca junta cadastros sozinho.
- Atendimento pode ser suspenso e retomado.
- Reserva das peças ao iniciar o pagamento, com prazo. Se duas vendedoras tentarem a última peça, só uma consegue. A saída do estoque acontece uma única vez.

## Etapa 4 — Pagamentos e fechamento da venda
- **Pix Asaas** com QR Code e copia e cola reais, validade e situação. A confirmação vem só do Asaas: não existe botão "marcar como pago". Duplo clique ou recarregar a página não criam outra cobrança.
- **Cartão na maquininha**: débito ou crédito, parcelas, maquininha e NSU, confirmados pela operadora. Fica marcado como registrado à mão e não entra na gaveta.
- **Dinheiro** com cálculo do troco.
- Vários meios na mesma venda, somados no servidor. Se o segundo meio falhar, o primeiro pagamento continua guardado.
- Pix pago depois que a reserva venceu ou depois do fechamento do caixa vai para uma fila de resolução, com rastreio.
- Venda concluída, saída do estoque, lançamento no financeiro e comissão acontecem juntos, sem risco de duplicar.

## Etapa 5 — Vendas, clientes, comissão e comprovante
- Telas Vendas (com filtros e detalhe), Clientes (compras, ticket médio, última compra) e Meu desempenho.
- Cancelamento e estorno com motivo e aprovação da supervisora. Mostra o andamento real da devolução do dinheiro.
- Meta e comissão percentual por vendedora, com data de início. Comissão apurada e comissão paga ficam separadas, e a regra fica gravada em cada venda.
- Comprovante em 80 mm e A4 com a frase "COMPROVANTE DE VENDA — NÃO É DOCUMENTO FISCAL". Reimprimir não gera nada novo.
- BI simples do PDV e alerta de estoque baixo da loja.
- Aviso de conexão. Sem internet, a tela nunca afirma que o pagamento entrou ou que a venda foi concluída.

## Etapa 6 — Testes e conferência de prontidão
- Testes no banco separado para todos os casos da lista do documento, incluindo duas operadoras na última peça, webhook repetido e fora de ordem, pagamento misto com falha e reimpressão.
- Testes das telas em notebook e tablet.
- Bateria completa sem regressões.
- Relatório de prontidão da LOJA ETINERANTE: unidade, estoque, usuárias, caixa, preços, comissão, conta Asaas, Pix validado e impressão. Não vou declarar "pronto para operar" com nada simulado.

## Depende de vocês (não vou inventar)
- Percentual de comissão e meta de cada vendedora.
- Logins das três vendedoras e da supervisora.
- Peças transferidas para a LOJA ETINERANTE, que hoje está zerada.
- Quais maquininhas serão usadas.
- Qual preço vale na loja: o preço de venda que já está no cadastro ou outro.
- Responsáveis da equipe de cobrança.

## Detalhes técnicos
- Migrações só aditivas, gravadas também em supabase/migrations. Tabelas novas com prefixos `cob_*` e `pdv_*`, com GRANT e RLS por papel/unidade.
- RPCs SECURITY DEFINER e idempotentes para venda, reserva, pagamento e caixa. Valores em centavos e datas no horário de São Paulo.
- Régua chamada por pg_cron, apontando para uma rota `/api/public/cron/cobranca` protegida por segredo.
- Pix via `/payments/{id}/pixQrCode`. O webhook trata as vendas do PDV num caminho restrito, sem mudar a regra geral das cobranças.
- Venda do PDV gera título a receber pelo motor oficial (origem `pdv`). Cartão vira recebível da adquirente e dinheiro entra na conta caixa da unidade.
