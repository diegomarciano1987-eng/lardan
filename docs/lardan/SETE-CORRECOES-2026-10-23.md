# LARDAN — Sete correções e provas
23/10/2026 — encerramento da validação

## Produtos: impressão acessível
Botão “Imprimir etiquetas” destacado na lista e ação por produto. A lista padrão não traz produtos arquivados; eles permanecem consultáveis pelo filtro de arquivados.

**Prova:** Sessão real de Ketllin abriu a janela, carregou 20 etiquetas e abriu folha com 20 linhas, uma coluna. Código lido no primeiro SVG: 17492. Sem alteração de produtos, códigos ou estoque.

## Cadastros: somente consulta de Consultoras
A entrada Cadastros da colaboradora vai diretamente para Consultoras. Tipos gerais e novo cadastro não aparecem sem permissão de escrita. Rotas de outras bases ficam bloqueadas.

**Prova:** Sessão real redirecionou /admin/cadastros para /admin/cadastros/pessoas?papel=consultora. Teste isolado com dois representantes recusou ficha de outra carteira e não retornou cadastro externo na busca. Documentos continuam mascarados.

## Estoque: removido e bloqueado
Estoque não aparece no menu da colaboradora; endereço direto e capacidades stock.* são bloqueados mesmo com concessões antigas.

**Prova:** Sessão real abriu /admin/estoque e recebeu “Acesso não liberado”. Testes confirmaram negação de stock.view e reservas diretas. Montagem continua pelo motor oficial: conferência e expedição usam auxiliares privados, indisponíveis à chamada direta.

## Inteligência: carteira vinculada
Rede, mapas agregados e BI SmallData são filtrados no banco pelo representante vinculado antes da soma. Sem vínculo, não há rede. O filtro do BI fica fixo em Daniel.

**Prova:** Sessão real exibiu 1.069 consultoras, 2 estados e 70 municípios na carteira autorizada, e representante Daniel fixo no histórico. Testes: representante correto, falha fechada sem vínculo e mapa agregado sem localização identificada. A contagem não implica que todas tenham praça preenchida ou estejam ativas.

## Remessas e praças: somente Daniel
Listagem LARDAN, histórico SmallData, opções de representante e praças estão restritos. Identidades de consultoras reassociadas a outra carteira também foram protegidas nas consultas.

**Prova:** Sessão real: representante Daniel; nove opções de praças ativas vinculadas (além de “Todas as praças” desse recorte). Histórico retornou 126 remessas exclusivamente vinculadas à identidade de Daniel. Operação LARDAN retornou zero remessas, sem preencher com registros inventados. A base possui praças históricas inativas; elas não foram reativadas. “Nova remessa” permanece porque a conta tem kit.manage cadastrado; Produtos e Cadastros permanecem somente leitura.

## Homologação: arquivamento reversível
Quatro produtos HOMOLOG arquivados e 32 cadastros HOMOLOG desativados, com cópias anteriores e auditoria no lote homolog-arquivo-20261023. Nada foi fisicamente apagado.

**Prova:** Leitura posterior confirmou quatro produtos arquivados, 32 parties inativas e 36 cópias no backup (4 products + 32 parties). A folha de impressão posterior não incluiu HOMOLOG. Histórico de vendas, finanças, estoque e logins foi preservado.

## Etiqueta: novo rolo alça à direita
Base 95 × 12 mm, suporte 100 mm, uma coluna, intervalo 3 mm: passo 15 mm. Impressão nos 30 mm à esquerda, alça direita sem impressão. BOPP acrílico, ribbon resina e tubete de 1 polegada são dados do rolo informado, não configurações comandadas pelo navegador.

**Prova:** Sete testes de etiquetas aprovados: medidas, uma peça por linha, código LBRP0295-005499 integral, referência distinta, quantidades válidas, limites de calibração e escape de conteúdo. Folha real: 20 etiquetas, 20 linhas, suporte de 100 mm (377,938 px no navegador). Nome pode ser abreviado visualmente; código e referência não são encurtados.


## Validação geral
434 testes isolados aprovados, zero falhas, 1.996 asserções; 7 testes de etiquetas aprovados. Bancada reconstruída do zero. Compilação automática: OK. Navegação real de Ketllin: nenhum erro de página. Nenhuma impressão física foi realizada.

## Limites e pendências
Interface não publicada; mudanças de proteção no banco já foram aplicadas à base compartilhada. A Argox, driver, escala, sensor do gap e leitura física precisam ser conferidos na estação antes de lote. 2.100 etiquetas × passo 15 mm = 31,5 m, diferente dos 30 m informados. Não declarei a impressão perfeita ou concluída. Logins de homologação e registros financeiros/Asaas de testes não foram excluídos: exigem rotina oficial e conferência de dependências externas.
