# LARDAN — Etiquetas legíveis, remessas corretas e produtividade da colaboradora

## Resultado esperado
Corrigir os cinco pontos em toda a operação, preservando permissões, carteira do representante, montagem e dados publicados. Não considerar concluído apenas porque os testes automáticos passaram: cada tela terá conferência visual e funcional na conta correta.

## 1. Etiquetas com contraste em todos os lugares
- Corrigir o botão compartilhado e as cores herdadas do topo do produto, sem remendar apenas o botão do print.
- Texto e ícone legíveis no topo escuro, em superfícies claras e nas linhas das listas. Estados normal, selecionado, foco, carregamento e desabilitado devem ser distinguíveis.
- Conferir lista de Produtos, cockpit/ficha, variantes, Estoque para perfis autorizados, remessa, maleta, documentos e os novos botões da montagem.
- Quando não puder imprimir, indicar o motivo: peça sem código, carregamento, quantidade inválida ou ausência de dados. Nunca esconder uma falha como botão inexplicavelmente apagado.

## 2. Representante: somente Daniel quando ele é o vínculo
- Reproduzir o erro na busca que mostrou a colaboradora como representante; comparar o vínculo salvo, o resultado da busca e o nome exibido.
- Corrigir todas as entradas: filtro da lista, nova remessa, busca de remessa, resultado, detalhe, histórico e documentos. Para a colaboradora vinculada a Daniel, somente a identidade de Daniel pode aparecer como representante.
- Impedir a substituição por nome da consultora/colaboradora e qualquer retorno à lista geral enquanto o vínculo carrega ou falha.
- Invalidar resultados guardados ao trocar de usuário ou atualizar o vínculo. Sem vínculo válido: sem dados da carteira, com motivo claro.
- Não trocar vínculos ou renomear cadastros para mascarar o erro; corrigir a origem do resultado.

## 3. Identificação da maleta por código de barras
- Usar o código oficial já existente da maleta, sem criar outra numeração. Conferir unicidade e resolução antes de disponibilizar impressão.
- Substituir o QR como identificação principal por Code 128, com código legível e identificação de maleta/remessa no mesmo rolo das peças.
- Acrescentar ação separada **Etiqueta da maleta**, distinta de **Etiquetas das peças**, na montagem, ficha e documentos.
- Ler o código impresso nas buscas de maleta/remessa e abrir a maleta correta, respeitando a carteira e as permissões.
- Preservar compatibilidade com os QR antigos já impressos; trocar a impressão nova, não inutilizar etiquetas antigas.
- Manter suporte de 100 mm, base 95 × 12 mm, área de impressão esquerda de 30 mm e intervalo de 3 mm. Bloquear código que não caiba sem cortar ou comprimir barras indevidamente.

## 4. Visão Geral da colaboradora, de verdade
Criar uma versão própria da Visão Geral, sem exigir papel administrativo nem carregar estoque, finanças ou totais nacionais.

**Conteúdo:**
- Peças bipadas hoje e no período escolhido.
- Maletas em que ela trabalhou, contadas uma vez por período.
- Evolução diária de bipagens e lista do trabalho recente: data, remessa, maleta e quantidade.
- Entradas aceitas, retiradas/correções e saldo de peças separado do volume de trabalho, para não confundir produtividade com conteúdo atual da maleta.
- Atalhos somente para os módulos e ações liberados pelo Daniel.

**Registros confiáveis:** cada bipagem aceita deve ser registrada com a colaboradora real, horário, maleta, variante, quantidade e identificador da operação. A gravação deve acompanhar a alteração oficial da montagem: uma não pode acontecer sem a outra.

Uma repetição de envio da mesma operação não conta duas vezes; duas bipagens reais do mesmo código de produto representam duas peças. Impressão, busca, leitura recusada e ajuste manual não viram bipagem. Histórico sem autoria comprovada não será atribuído à colaboradora; mostrar “sem dados” e a data a partir da qual o registro confiável está disponível.

## 5. Imprimir por peça durante a montagem
- Botão com ícone de impressora e identificação acessível ao lado de cada peça, junto da foto, descrição e quantidade, tanto na composição durante a bipagem quanto na conferência.
- Abrir somente a variante daquela linha; sugerir uma etiqueta e permitir ajustar a quantidade antes de imprimir.
- Não alterar quantidade da maleta, estoque ou produtividade ao imprimir.
- Suspender a recuperação automática do foco enquanto a janela de etiquetas estiver aberta; ao fechar, voltar ao campo de bipagem. Preservar a fila de leituras e impedir perda ou duplicação de peças.

## Ordem de execução segura
1. Reproduzir os erros na conta da colaboradora e inventariar todas as telas de etiquetas.
2. Corrigir contraste e identidade do representante; validar antes de avançar.
3. Integrar identificação por barras e impressão por linha, mantendo compatibilidade antiga.
4. Implementar registros auditáveis e Visão Geral pessoal.
5. Executar a matriz abaixo, repetir os testes de regressão e entregar relatório com capturas, resultados e limites.

Não publicar automaticamente. Alterações de proteção e registros no banco serão compatíveis com a versão publicada; mudanças na interface só chegam ao site publicado após publicação autorizada.

## Testes tela a tela — condição de entrega
| Tela | Prova obrigatória |
|---|---|
| Produtos — lista | Botão geral e por linha legíveis; peça correta; sem alterar cadastro. |
| Cockpit/ficha do produto | Reproduzir o print recebido; contraste do botão, diálogo e prévia; impressão de produto com/sem variantes. |
| Variantes | Impressão da variante certa; código ausente com motivo; quantidade revisável. |
| Estoque — conta autorizada | Ações legíveis e quantidade correta; nenhuma movimentação pela impressão. |
| Estoque — colaboradora | Menu ausente e endereço direto bloqueado, sem regressão. |
| Remessas — filtros e busca | Conta real vinculada a Daniel: somente Daniel; nenhuma opção com nome da colaboradora ou outro representante. |
| Nova remessa | Daniel fixo e praças da carteira; leitura apenas não permite criação. |
| Detalhe e histórico da remessa | Nome, vínculo e consultoras coerentes; busca fora da carteira recusada. |
| Montagem — bipagem/composição | Botão em cada peça; abrir/fechar impressão e continuar bipando sem perder foco, fila ou contagem. |
| Conferência da maleta | Foto, quantidade e impressora por linha; código e quantidade impressos correspondem à linha. |
| Identificação da maleta | Code 128 contém código oficial completo; leitura abre a maleta correta; código externo à carteira recusado; QR antigo continua reconhecido. |
| Documentos de maleta/remessa | Identificação nova e etiquetas de peças separadas; mesma calibração do rolo. |
| Visão Geral — colaboradora | Bipar na bancada, abrir Visão Geral, atualizar/reentrar e conferir totais pessoais persistidos. Segunda colaboradora não recebe o trabalho da primeira. |
| Visão Geral — falhas e permissões | Sem vínculo, sem dados e erro de leitura diferenciados; nenhum carregamento infinito ou pedido de acesso financeiro. |

**Testes das regras:** vínculo exclusivo; conta sem vínculo; permissões Ver/Alterar; código oficial; idempotência de operação; duas peças com o mesmo barcode; leitura recusada; impressão não contada; ajuste manual separado; retiradas; maleta distinta no período; virada do dia em America/Sao_Paulo; autoria e isolamento entre colaboradoras. Montagem com gravações será exercitada na bancada isolada, não em maleta real de produção.

**Provas entregues:** capturas de cada tela e estado relevante, chamadas recusadas fora da carteira, totais antes/depois na bancada, testes automáticos e compilação sem erros. Teste automático de lógica não substitui conferência de contraste.

## Detalhes técnicos
- Reutilizar `EtiquetasImprimir`, `Button`, tokens semânticos e o gerador Code 128 existente; corrigir herança de cores no escopo adequado.
- Auditar `colab_meu_escopo`, buscas/listas/criação de remessa e seus resultados; consultas e caches vinculados à identidade, sem confiar no filtro visual como proteção.
- Integrar o código oficial de `kits` à resolução autorizada; manter `qr_token` somente para compatibilidade de leitura antiga.
- Métricas calculadas no servidor por usuário autenticado e carteira autorizada. Registrar eventos imutáveis no motor oficial de alteração da composição, com permissões explícitas e testes em bancada.
- Usar controles premium de período e atualizar as consultas após bipagens confirmadas; leitura vazia, negada e erro têm estados distintos.

## Limite da prova física
Conferir a Argox e o leitor na estação continua indispensável. A bancada prova conteúdo, formato e funcionamento da tela, não ribbon, sensor, driver ou qualidade do papel impresso. Não será declarado “perfeito” sem etiqueta física impressa e lida. As medidas informadas continuam divergentes: 2.100 etiquetas × passo de 15 mm = 31,5 m, não 30 m.