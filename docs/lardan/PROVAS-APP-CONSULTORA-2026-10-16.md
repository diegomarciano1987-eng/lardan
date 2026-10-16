# App da consultora — conferência do PDF e provas

## Resultado desta etapa
Não está concluído o conjunto inteiro do PDF. Foram implementados controles e solicitações de pós-venda, mas faltam validações autenticadas e etapas operacionais descritas abaixo. Não houve publicação.

- PDF fonte: `Melhorias_App_Consultora_Lardan.pdf`, oito páginas, autoria indicada no documento: Daniel Maciel.
- Prazo oficial informado por Diego: troca em até **45 dias**; garantia de **dois anos**, seguindo o manual.
- Migrações aditivas aplicadas: 0090–0094. Nenhuma delas altera preços existentes, estoque, baixa ou saldo financeiro.
- Banco isolado novo: 332 migrações e três arquivos pendentes locais; **250 testes aprovados, 1.293 verificações**, em 20 arquivos. As propostas locais não foram aplicadas à base compartilhada.
- Regras puras: quatro testes aprovados, incluindo dia 45 aceito, dia 46 recusado, garantia bissexta, idade de pedido e preço ,90.
- Compilação: última entrada conferida `build OK`, 23:55:27 UTC.
- Navegador: manual em 1280×1800 e 390×844, sem transbordamento horizontal e sem erros de execução. Fila de análise abriu para Master, vazia, sem criar solicitação real.
- A sessão atual recebe “Acesso não liberado” na área da consultora; portanto **venda, fotos, letra grande, leitura de etiqueta e pagamento não estão comprovados de ponta a ponta nessa área**. Não foram concedidos acessos para contornar isso.

## Matriz do PDF
“Implementado” abaixo descreve o código disponível na prévia, não substitui prova de operação com uma consultora.

| Itens | Resultado e limite |
|---|---|
| 1.1 | Maletas em montagem ocultadas; prioriza operação e recebida. Falta validação visual como consultora. |
| 1.2 | Resumo de pedidos abertos por cliente e quantidade no card. Mudança automática de etapa e divergência original entre contagens ainda não comprovadas. |
| 1.3 | Telefone obrigatório com máscara no cadastro. Falta execução autenticada. |
| 1.4–1.5 | Aviso único; próxima ação; cancelar em menu com confirmação. Falta execução autenticada. |
| 1.6 | Não foi feita nova limpeza. Exige identificação dos registros e autorização antes de expurgo. |
| 2.1–2.2 | Busca de cliente no servidor por nome/telefone e recentes; Nova cliente no topo, cadastro retorna à seleção. |
| 2.3 | Categoria e banho disponíveis em seletores pesquisáveis com opções reais da maleta; apresentação por ícones específicos ainda pendente. |
| 2.4 | Leitor de etiqueta com câmera, alternativa digitada, adição direta quando a correspondência é única; código ambíguo exige escolha. Câmera física não testada. |
| 2.5–2.7 | Menu inferior oculto durante venda; adicionar/remover e quantidade somente quando necessário; foto ampliável. Validação visual autenticada pendente. |
| 2.8 | Sugestões da mesma coleção e outra categoria, somente das peças próprias disponíveis. Sem inventar conjuntos ou descontos. |
| 2.9 | Confirmação de pedido e resumo WhatsApp. É pedido em atendimento, não venda paga nem comprovante fiscal. |
| 2.10 | Cobrança oficial após criação preservada. Forma e data persistidas na revisão do pedido ainda pendentes. |
| 3.1 | Cadastro já possui rótulo “Nome comercial do produto-base”; app/vitrine leem o nome cadastrado. Não foram inventados nomes nem criado campo independente. |
| 3.2 | Sugestões novas terminam no próximo ,90. Preços atuais e pedidos anteriores intactos. Regra geral de gravação de preços não foi reconstruída. |
| 3.3 | Vitrine tem Enviar esta peça com nome, preço, link ancorado e endereço da foto quando existente. Não promete anexar automaticamente um arquivo ao WhatsApp. |
| 3.4 | Destaques automáticos por lançamento/mais vendidas pendentes; curadoria publicada preservada. |
| 3.5 | Link do manual e garantia oficial disponíveis. Material/banho específicos dependem de preenchimento confiável por produto. |
| 3.6 | Botão Quero esta abre interesse no WhatsApp, sem reservar estoque. |
| 3.7 | Fotos aprovadas intactas. Padronização e fotos no corpo dependem de material autorizado; nenhuma imagem inventada. |
| 4.1–4.3 | Data, idade com faixas 0–3/4–7/8+, abas e totais por situação, mensagem conforme status. |
| 4.4–4.5 | Componentes de cobrança oficial reaproveitados. Não foi emitida cobrança real nem validado parcelamento como consultora nesta etapa. |
| 4.6 | Valor de acerto/comissão não exibido como estimativa inventada. Rotina de acerto encontrada em pacote ainda não aplicado; exige regra financeira oficial. |
| 4A: abertura | Botões nos pedidos pagos e compras da cliente; quatro etapas; prazo vem do pagamento confirmado, com fallback de criação, no fuso São Paulo; até três fotos privadas, obrigatórias na garantia; exceção apenas solicitada. |
| 4A: análise | Protocolo, snapshots, estados sequenciais, resposta e eventos auditados; fila Master/Qualidade e fotos com endereço temporário. Testes isolados cobrem privacidade, idempotência, dia 45/46 e impossibilidade de aprovação direta pela consultora. |
| 4A: operação | Troca imediata com diferença de preço, ajuste oficial de estoque, crédito, devolução no acerto e avisos de cada mudança em Novidades **não implementados**; dependem do fluxo de acerto/financeiro aprovado. Solicitação não movimenta dinheiro ou estoque. |
| 4A: indicadores | Taxa por fornecedor/produto e prazo médio de resolução ainda pendentes; requerem vendas e devoluções efetivas, não apenas solicitações. |
| 5.1 | Compras, itens, total pago, preferências e aniversário na ficha; novos resumos protegidos por consultora. |
| 5.2–5.5 | Lembretes automáticos de recompra/aniversário, ação específica por pedido, kits com desconto e combinações para clientes ainda pendentes. Não se presume autorização de envio automático. |
| 5.6 | Minhas clientes e Vai comprar implementados. |
| 6.1–6.4 | Ganhos, meta/faixa comercial, giro, data de acerto e liga bloqueados por falta de fonte aplicada confiável e regras oficiais; comissões de indicação não foram confundidas com comissão de venda. |
| 6.5 | Artes/story semanais dependem de conteúdo aprovado. Não foram produzidos conteúdos fictícios. |
| 6.6 | Mensagens editáveis de abordagem, objeção, pós-venda e cobrança em Mais. |
| 6.7 | Concordância “Falta 1 aprovada” corrigida; link permanente existente preservado. Link nominal exige alias único sem quebrar convites existentes; pendente. |
| 6.8 | Status já existente preservado; estágio “maleta enviada” adicional não implementado. |
| 7.1–7.4 | Texto-base 18px, contraste e nomes mais claros; Revisar com orientação quando vazio. Falta inspeção de todas as telas autenticadas. |
| 7.5 | Confirmação de cancelamento e revisão antes do pedido; não foi revalidado todo o inventário de ações sensíveis. |
| 7.6 | Ajuda atual preservada. Vídeos por tela dependem de vídeos aprovados da Academy. |
| 7.7 | Letra grande +20% com preferência por aparelho. Falta medir renderização em cada tela autenticada. |
| 7.8 | Instalação existente preservada; primeiro acesso/ilustrações específicos ainda não revalidados. |
| 8.1 | Peças e fotos existentes preservadas; filtro por categoria/status na Minha maleta ainda pendente. |
| 8.2 | Valor de venda explicado; não apresentado como valor do acerto. |
| 8.3–8.4 | Conferência/recebimento existentes preservados; problema com foto e rastreio completo ainda pendentes. Não simplificar conferência em detrimento da custódia. |
| 8.5–8.6 | Novidades e indicações existentes preservadas; compartilhar lançamento e novos estados ainda pendentes. |
| 9 | Comparação de métricas antes/depois e piloto com 2–3 consultoras ainda não realizados. |

## Provas técnicas reproduzíveis
1. Preparar uma base local vazia com `tests/isolado/subir.sh`.
2. Rodar `bun test tests/isolado` com as variáveis de conexão gerenciada removidas do processo; não usar a base compartilhada.
3. Rodar `bunx vitest run tests/consultora/regras.test.ts` para as regras puras.
4. Testes novos: `tests/isolado/consultora-pos-venda.test.ts` e `tests/isolado/consultora-busca.test.ts`.

### Falhas observadas e limites
- Uma repetição sem recriar a base local apresentou resíduos de testes anteriores. Na base vazia, a execução final passou integralmente (250 testes). O código de etiqueta do teste passou a ser único por execução.
- Dois testes REST preexistentes de custo (`marketing` e `estoque`) falharam na expectativa de resposta vazia de `variant_costs`; 43 outros testes dessa execução passaram. Não foi identificado vazamento confirmado: o teste também falha para resposta não-lista. É pendência de diagnóstico, não prova de sigilo aprovado por REST.
- Essa suíte REST preexistente usa massa HOMOLOG e limpeza própria; foi executada antes da identificação desse comportamento. Não repetir contra dados compartilhados para validar estas melhorias: usar a bancada isolada. Não registrar esses resultados como prova “sem nenhuma escrita compartilhada”.
- Fotografias abandonadas após falha de envio não têm rotina de limpeza nesta etapa. Bucket privado limitado a 5 MB por arquivo; fotos ficam sob a pasta da conta. Upload, associação efetiva e retomada após falha de rede precisam de prova autenticada.
- Nenhuma operação de troca efetiva, crédito, devolução de peça ou ajuste financeiro foi realizada.

## Próximo desbloqueio necessário
Uma conta de consultora existente, autorizada para validação, e as regras/fontes oficiais de comissão/acerto e conteúdo da Academy. Sem isso, não declarar todos os pontos concluídos nem publicar.