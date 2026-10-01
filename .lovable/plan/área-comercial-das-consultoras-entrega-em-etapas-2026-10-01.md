# Área comercial das consultoras — entrega em etapas

O documento descreve uma frente grande. Ela será entregue em 6 etapas. Cada etapa precisa ficar estável e com provas antes da próxima, e nada vai para o site oficial sem você pedir. Não envio convites reais, não crio dados fictícios e não mexo no motor financeiro nem no Asaas além do que está descrito.

## Etapa 0 — Inventário e conta de teste (curta)
- Levantar o que já existe e funciona: convites, área `/consultora`, vitrine `/$slug`, maletas, pedidos e Asaas. Comparar `db/pendentes` com o que já está no banco.
- Quando você confirmar o e-mail, ligar a conta projetos.diegosilva@hotmail.com ao papel de consultora e a um cadastro de pessoa marcado como "conta de teste do proprietário". Depois entrar pelo cartão Consultora e mostrar prints.

## Etapa 1 — Corrigir o que bloqueia a jornada (prioridade do documento)
- **Entrega e aceite:** não permitir aceite enquanto a maleta está em trânsito. Uma confirmação de entrega que chega depois não pode reabrir um aceite já feito nem somar o saldo duas vezes. Uma entrega recusada não libera aceite. Encaminhar por representante exige que a custódia tenha sido confirmada.
- **Pedido:** o banco passa a recusar "concluído" sem uma venda de verdade, até existir a operação de fechamento (etapa 4).
- **Vitrine pública:** desligar a rota antiga, aberta a qualquer visitante, que cria pedido e reserva estoque. Antes, confirmo que nenhum outro canal depende dela. Pedidos antigos ficam preservados.
- **Elegibilidade e preço:** uma única regra no banco decide se a peça aparece, se pode ser reservada e se pode ser vendida. Preço ausente nunca vira venda de graça.
- Testes de regressão no ambiente isolado para cada correção, incluindo as versões antigas das funções.

## Etapa 2 — Convite e primeiro acesso
- Convite a partir da consultora já cadastrada, com estados honestos: criado, enviado, falha, vencido, revogado e aceito. "Entregue" só aparece com prova de entrega.
- Depois do aceite, a pessoa vai para `/consultora`. Quem tem mais de um papel pode trocar de área.
- Primeiro acesso com uma lista curta de tarefas: nome público, foto, cidade de atendimento, WhatsApp, endereço da vitrine e orientações de recebimento da maleta. A vitrine começa como rascunho, com pré-visualização e botão de publicar.

## Etapa 3 — Vitrine pessoal com WhatsApp
- Topo de perfil profissional: capa com ponto focal, retrato, nome, "Consultora Lardan", cidade, apresentação, botão "Falar com [nome]", "Ver semijoias" e "Compartilhar".
- Mostra só peças aceitas, publicadas e disponíveis das maletas dessa consultora, sem repetir peça. Tem busca, filtros e seleção de interesse que fica só no aparelho da visitante.
- "Tenho interesse" e a lista de peças abrem o WhatsApp com a mensagem pronta. O número é corrigido para não repetir o 55. Não há checkout nem reserva pela vitrine.
- Sem estoque, a página continua como perfil de atendimento. Nada de avaliações, selos ou números inventados.

## Etapa 4 — App da consultora: clientes, pedidos e vendas
- Início com o que fazer hoje. Funciona bem no celular e no computador.
- CRM de clientes separado do CRM de candidaturas, usando o cadastro único de pessoas. Tem cadastro rápido, ficha, linha do tempo, funil de atendimento, próximos contatos e listas como aniversariantes, retornos do dia e clientes sem compra recente. As mensagens prontas abrem o WhatsApp, sem disparos automáticos.
- Pedido assistido: cliente → peças da maleta com origem rastreável → desconto dentro da política → forma de pagamento e entrega → revisão.
- Estados separados para pedido, venda, pagamento, entrega e reserva, todos feitos em operações atômicas no banco. Reservas têm prazo configurável e expiração automática segura. Cancelar libera a peça uma única vez.
- Recibo comercial que pode ser compartilhado, deixando claro que não é nota fiscal.

## Etapa 5 — Pagamentos, devolução e garantia
- Separar as três relações: cliente → recebedor, consultora → Lardan e Lardan → consultora. A consultora pode marcar um recebimento manual, com autoria. Isso nunca equivale à confirmação do Asaas.
- O link de pagamento para a cliente final só será ligado depois de você decidir quem recebe e com qual conta. Até lá, a tela mostra o bloqueio com o motivo.
- Devolução fica em trânsito até a matriz conferir. A garantia de 2 anos liga pedido, produto, fotos, análise e solução.

## Pontos que dependem de você (não vou inventar)
- Prazo da reserva de pedido e limite de desconto da consultora.
- Quem recebe o pagamento da cliente final (Lardan ou a consultora) e em qual conta.
- O texto da política de garantia exibida na vitrine.

## Detalhes técnicos
- As correções de banco entram por migrações novas, com `SECURITY DEFINER`, bloqueio de linhas em ordem estável e chaves de idempotência. Cada mudança relevante fica registrada em `audit_logs`.
- A rota anônima legada tem a permissão de execução para `anon` revogada, sem apagar a função. O fluxo autenticado continua.
- Os testes da jornada são adicionados em `tests/isolado/`, sem tocar no banco compartilhado.
- As decisões de arquitetura ficam registradas em `AGENTS.md`.
