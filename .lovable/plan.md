# Plano de correções imediatas (17/11)

Investiguei cada ponto no sistema e no Asaas antes de escrever. Abaixo, o que encontrei e o que vou fazer, na ordem de urgência.

## 1. Asaas: Taynara não recebeu SMS nem WhatsApp (o mais grave)

**Causa achada (conferida direto no Asaas):** o cadastro principal dela no Asaas está com o celular `5518996980258` — com o "55" na frente. O Asaas entende isso como número inválido, por isso o SMS falha (X vermelho do print) e o WhatsApp não sai. O e-mail chega porque o e-mail está certo.

Quem estragou: a rotina que "liga os avisos" depois de criar a cobrança (feita no pacote anterior) manda o celular do Lardan sem tirar o 55. E a conferência diária do cadastro não percebe, porque ela tira o 55 antes de comparar e acha que está "igual". Dois defeitos juntos — por isso voltava sempre.

**Correção:**
- Celular sempre vai ao Asaas com 11 dígitos (DDD + 9 + número), em todos os caminhos de envio.
- A conferência diária passa a acusar como diferente qualquer celular com 55 na frente, e corrige sozinha.
- Varredura única em todas as clientes do Asaas: quem estiver com celular de 13 dígitos é corrigido, e as cobranças abertas dessas clientes recebem o aviso de novo (SMS + WhatsApp + e-mail).
- Teste automático que trava o 55 para nunca mais voltar.
- Prova: consulta no Asaas antes/depois da Taynara e a lista de clientes corrigidas.

## 2. Abertura travada (caso Paula / Marcelo)

**O que achei:** a Paula assinou contrato e promissória hoje às 10h07 (no reenvio). Mas a faixa "Abertura de Paula em andamento" continua no celular do Marcelo, porque o rascunho fica só no aparelho e só aceita uma abertura por vez — para começar outra, o sistema manda descartar a da Paula.

**Correção:**
- Cada abertura fica guardada separada; ele pode começar uma nova sem perder a anterior.
- Nova lista "Aguardando assinatura" na Captação, lida do servidor (não só do aparelho): nome, maleta, contrato/promissória pendente ou assinado, botões "Reenviar link", "Copiar link", "Mandar por SMS" e "Verificar se já assinou".
- Quando as duas assinaturas chegam, a abertura sai sozinha da lista e a faixa some (inclusive a da Paula).
- Histórico: aberturas concluídas ficam consultáveis.
- Observação: o link da ZapSign vai pelo WhatsApp, não por e-mail. Vou deixar isso escrito na tela, com o botão de copiar link bem visível.

## 3. Representante deixar mais uma maleta para a mesma consultora

Hoje a trava "Ela já tem uma maleta nesta remessa" barra o representante. A equipe já ganhou "Abrir 2ª maleta"; o representante não.
- No app do representante, ao escolher consultora que já tem maleta, aparece "Deixar como 2ª maleta" (confirmação simples, motivo opcional), em vez do erro.
- A 2ª maleta tem promissória própria, com o valor dela, igual à primeira.
- Mesmas proteções de hoje: só consultora da carteira dele, nunca bloqueada/desligada, tudo auditado.

## 4. Promissória na entrega em mãos (consultora já ativa)

No cartão "Para entregar em mãos", junto do botão "Entreguei em mãos", entra um quadro "Promissória desta maleta" que **não bloqueia a entrega**:
- **Assinar pelo celular (ZapSign):** envia, copia link, verifica.
- **Assinar no papel (A4):** botão "Imprimir promissória" (mesma promissória A4 da montagem, já com nome, CPF, valor e por extenso) e depois "Ela assinou no papel" — com foto opcional da folha assinada.
- O selo mostra: pendente / assinada digital / assinada no papel. A equipe vê o mesmo selo na maleta.

## 5. Sugestão de peças na montagem que "não trava"

**Causa achada:** a quantidade que a montadora escolhe (ex.: 30 → 50) fica guardada só na tela aberta. Fechou o leitor, recarregou ou trocou de maleta, volta para a sugestão.
- A sugestão passa a ser a média de **peças enviadas** nas últimas 3 maletas da consultora (SmallData + Lardan); sem histórico, o padrão de cliente nova.
- O número escolhido fica gravado na própria maleta: reabriu, continua 50 (ou 60, o que ela escolheu). "Voltar ao sugerido" continua existindo.
- A tela mostra "Sugerido: X (média das últimas 3: a, b, c)" e "Escolhido: Y".

## 6. Ficha completa da candidata para o representante

Mantém a tela atual. No cartão da candidata (onde está "Perfil e sonho") entra "Ver ficha completa":
- Dados completos: nome, CPF, nascimento, RG, estado civil, WhatsApp, e-mail, endereço completo com link para o mapa.
- Todas as respostas do formulário de candidatura, na ordem em que ela respondeu.
- Só para a candidata da carteira dele (mesma regra de hoje); o Daniel continua vendo espelhado.

## 7. PDF "Como instalar o app no celular"

Guia curto e bem visual, com as cores e o logo da Lardan:
- iPhone (Safari): abrir o link → Compartilhar → "Adicionar à Tela de Início" → Adicionar.
- Android (Chrome): abrir o link → "Instalar" (ou menu ⋮ → "Adicionar à tela inicial").
- O que fazer se não aparecer a opção (abrir no Safari/Chrome, não dentro do WhatsApp).
- Telas reais capturadas do app, letra grande, poucas palavras. Salvo em Arquivos.

## Ordem de execução
1 → 2 → 3 → 4 → 5 → 6 → 7, cada etapa com teste e prova (tela ou consulta), sem mexer em dinheiro, estoque ou notas.

## Detalhes técnicos
- Asaas: normalizar `celular` em `ativarAvisos` e no executor (`asaas_exec_contato`); em `cliente-espelho.ts`, comparar o valor bruto do Asaas (13 dígitos com 55 = diferença). Varredura via listagem paginada `/customers`, POST só `mobilePhone`, depois `resendNotification` das cobranças PENDING/OVERDUE; log por cliente.
- Abertura: rascunhos por chave em `localStorage`; RPC nova `rep_aberturas_pendentes` (rep_portal_pode) lendo leads da carteira + `assinaturas_digitais` + ciclo.
- 2ª maleta: variante do `rep_maleta_repassar`/`rep_maleta_trocar_destino` com flag de segunda maleta, reaproveitando as checagens de `remessa_abrir_segunda_maleta`; gatilho de remessa respeita a flag.
- Promissória em papel: tabela própria de registro manual (ciclo, quem marcou, foto no bucket privado `assinaturas`), sem alterar `assinaturas_digitais`; impressão reaproveita o motor A4 existente.
- Montagem: coluna `kit_cycles.montagem_total_pecas` + RPC para gravar; `maleta_total_sugerido` passa a usar peças enviadas.
- Ficha: RPC `rep_candidata_ficha` (mesma permissão de `rep_candidata_perfil`) com dados do lead + `candidatura_submissions`.
