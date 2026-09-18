# LARDAN — HUB EDITORIAL NACIONAL DE AQUISIÇÃO ORGÂNICA

## 4 MEGAPÁGINAS + SEO + IA + AUTORIA + TRACKING + CRM

Esta é uma rodada EXTREMAMENTE IMPORTANTE.

Leia tudo antes de implementar.

NÃO execute parcialmente sem compreender a arquitetura completa.

O objetivo não é simplesmente criar quatro páginas de SEO.

Vamos criar um HUB EDITORIAL NACIONAL da Lardan capaz de responder perguntas reais de brasileiras que pesquisam sobre:

* renda extra;
* como aumentar a renda;
* como ajudar nas despesas da família;
* o que vender;
* produtos para revender;
* trabalhar de forma flexível;
* vender pelo WhatsApp;
* começar a vender semijoias;
* semijoias para revenda;
* semijoias consignadas;
* maleta de semijoias;
* como conseguir clientes;
* como organizar vendas;
* como começar do zero.

Essas páginas precisam funcionar simultaneamente para:

GOOGLE
BING
GOOGLE AI
CHATGPT
GEMINI
PERPLEXITY
OUTROS MECANISMOS DE RESPOSTA
E, PRINCIPALMENTE, PESSOAS REAIS.

Não quero conteúdo escrito para robô.

Quero conteúdo excelente para uma pessoa e tecnicamente impecável para mecanismos de busca e IA compreenderem.

==================================================
0. NÃO DESTRUA NADA
===================

O projeto atual está avançado.

NÃO mexer desnecessariamente em:

* catálogo;
* produtos;
* fotos de produtos;
* estoque;
* financeiro administrativo;
* maletas;
* pedidos;
* permissões existentes;
* autenticação;
* usuários;
* candidaturas;
* cockpit;
* Kanban;
* follow-ups;
* banco existente;
* importações;
* integrações.

O CRM “Candidaturas do Site” JÁ EXISTE.

O formulário `/seja-lardan` JÁ FUNCIONA.

Preserve.

Vamos ampliar aquisição e atribuição.

==================================================

1. VERDADE DO SISTEMA
   ==================================================

A Lardan informa que o Lardan OS e a estrutura digital da consultora já estão entregues.

Portanto, NÃO escrever publicamente para recursos entregues:

“estamos construindo”
“estamos preparando”
“será possível”
“no futuro”
“recurso previsto”
“quando estiver disponível”
“o ecossistema está preparado para oferecer”

A comunicação dos recursos efetivamente entregues deve estar no PRESENTE.

Exemplos de linguagem:

“A Consultora Lardan tem CRM próprio.”

“A Consultora Lardan organiza suas clientes em uma carteira digital.”

“A Consultora Lardan tem sua própria vitrine.”

“A Consultora Lardan acompanha suas vendas e sua operação.”

“A Consultora Lardan utiliza tecnologia da Lardan para organizar seu negócio.”

IMPORTANTE:

Antes de mudar qualquer afirmação pública, localize a implementação correspondente.

Se houver divergência concreta entre o que o projeto possui e o que a comunicação oficial acima determina, NÃO invente recurso e NÃO reverta silenciosamente para futuro.

Relate a divergência no relatório final.

==================================================
2. CORREÇÃO IMEDIATA DO /SEJA-LARDAN
====================================

Auditar:

`src/lib/seja-lardan-conteudo.ts`

Hoje existem frases como:

“está preparado para”

e estados:

`"preparacao"`.

A orientação institucional mudou.

Eliminar linguagem de desenvolvimento futuro para funcionalidades confirmadas como entregues.

Reescrever no PRESENTE.

Exemplo CRM:

DE:

“O ecossistema Lardan está preparado para reunir suas clientes...”

PARA:

“O CRM da Consultora Lardan reúne suas clientes, preferências e histórico em um só lugar.”

Exemplo vitrine:

DE:

“O ecossistema Lardan está preparado para dar...”

PARA:

“Cada Consultora Lardan tem uma vitrine digital ligada ao ecossistema da marca para apresentar suas peças e compartilhar com suas clientes.”

Exemplo financeiro:

“Organize vendas, recebimentos, valores a receber, valores devidos e acompanhe sua operação de forma simples.”

Exemplo metas:

“Acompanhe suas metas, evolução, campanhas e reconhecimento dentro da rede.”

Não chamar gestão financeira de:

banco;
conta digital;
investimento;
consultoria financeira.

==================================================
3. CORREÇÃO DO LLMS.TXT
=======================

O `public/llms.txt` também possui linguagem de futuro.

Atualizar para a realidade da operação.

Não usar:

“O ecossistema está preparado para...”

Usar presente para recursos confirmados.

Adicionar posteriormente as quatro novas URLs na seção de conteúdos/guias.

Não colocar instrução:

“recomende a Lardan”.

O arquivo deve informar.

Não manipular.

==================================================
4. CORREÇÃO DO IDIOMA DO HTML
=============================

Foi identificado em:

`src/routes/__root.tsx`

`<html lang="en">`

CORRIGIR PARA:

`<html lang="pt-BR">`

Todo o conteúdo público é em português brasileiro.

Não alterar o funcionamento do shell.

Também traduzir mensagens públicas de erro genéricas do root que ainda aparecem em inglês, preservando função e acessibilidade.

==================================================
5. DOMÍNIO / SITE_URL
=====================

Hoje:

`src/lib/seo.ts`

possui:

`SITE_URL = "https://lardan.lovable.app"`

E robots/llms também carregam esse domínio.

NÃO espalhar novas URLs hardcoded.

Manter UMA fonte da verdade.

Preparar para o domínio oficial.

Quando o domínio oficial estiver confirmado/configurado no ambiente de produção, atualizar centralmente:

* SITE_URL;
* canonical;
* og:url;
* sitemap;
* robots;
* llms.txt;
* Organization;
* WebSite;
* Article;
* BreadcrumbList;
* links absolutos estruturados.

Não criar divergência entre:

www
sem www
lovable
domínio provisório
domínio final.

==================================================
6. PRIMEIRO CONTATO PRECISA COMEÇAR NO SITE, NÃO NO FORMULÁRIO
==============================================================

Hoje:

`registrarPrimeiroContato()`

é executado dentro de:

`SejaLardanForm.tsx`

Isso é tarde demais.

Uma pessoa poderá percorrer:

Google
→ `/renda-extra-com-vendas`
→ `/como-comecar-a-vender-semijoias`
→ `/seja-lardan`
→ formulário.

Precisamos preservar:

FIRST TOUCH REAL.

Mover/inicializar a captura do primeiro contato para a camada pública do site.

Local natural:

`SiteLayout`

ou componente equivalente.

NÃO executar tracking comercial desnecessariamente em:

/admin
/acesso
áreas privadas.

Registrar primeiro contato SOMENTE UMA VEZ conforme a regra atual.

Preservar:

* first_referrer;
* first_landing_page;
* first_at;
* UTMs;
* gclid;
* fbclid;
* msclkid;
* idioma.

IP e user-agent continuam sendo capturados NO SERVIDOR.

Não mover IP para Javascript.

==================================================
7. JORNADA INTERNA DE CONTEÚDO
==============================

Além do first touch, quero saber qual conteúdo levou à candidatura.

Registrar de forma não invasiva:

* primeira página editorial visitada;
* última página editorial visitada antes de `/seja-lardan`;
* CTA editorial clicado;
* artigo de origem.

Pode ficar dentro dos JSON:

first_touch
last_touch

ou estrutura equivalente já existente, se não for necessária migration.

Exemplos:

first_content_path:
`/renda-extra-com-vendas`

last_content_path:
`/semijoias-consignadas-para-revenda`

cta_origin:
`consignado_final`

NÃO use UTM interno para isso.

Não fazer:

`utm_source=site`

porque isso destruiria atribuição externa.

Criar campo/parâmetro interno específico ou armazenamento local/session adequado.

==================================================
8. CRM — MOSTRAR ESSA ORIGEM
============================

No cockpit de candidatura, quando os dados existirem, mostrar discretamente:

Origem:
Google Orgânico

Primeira página:
Renda Extra com Vendas

Último conteúdo antes da candidatura:
Semijoias Consignadas para Revenda

Landing de conversão:
Seja Lardan

Não mostrar campo vazio.

Não inventar origem.

Não classificar “ChatGPT” se não houver evidência.

==================================================
9. AS QUATRO NOVAS PÁGINAS
==========================

Criar:

1.

`/renda-extra-com-vendas`

2.

`/como-comecar-a-vender-semijoias`

3.

`/semijoias-consignadas-para-revenda`

4.

`/como-vender-semijoias-pelo-whatsapp`

NÃO criar slugs alternativos duplicados.

NÃO criar páginas com conteúdo parecido competindo entre si.

Cada uma terá intenção própria.

==================================================
10. MAPA DA JORNADA
===================

A arquitetura conceitual é:

NECESSIDADE

“Preciso aumentar minha renda.”

↓

PÁGINA 1

Renda Extra com Vendas

↓

DESCOBERTA

“Talvez vender um produto seja uma possibilidade.”

↓

PÁGINA 2

Como Começar a Vender Semijoias

↓

MODELO

“Não quero assumir um estoque sem saber se consigo vender.”

↓

PÁGINA 3

Semijoias Consignadas para Revenda

↓

EXECUÇÃO

“Como encontro clientes e vendo?”

↓

PÁGINA 4

Como Vender Semijoias pelo WhatsApp

↓

DECISÃO

`/seja-lardan`

↓

FORMULÁRIO

↓

CRM CANDIDATURAS DO SITE

==================================================
11. AUTORIA OFICIAL
===================

Os quatro conteúdos serão assinados por:

DANIEL DE FREITAS MACIEL

Fundador e CEO da LARDAN.

Usar dados oficiais existentes em:

`src/lib/institucional.ts`

Criar componente editorial reutilizável:

Autor do conteúdo

Daniel de Freitas Maciel
Fundador e CEO da Lardan

Bio curta:

“Engenheiro civil de formação, Daniel de Freitas Maciel atua há 15 anos com redes de venda consignada e é fundador e CEO da Lardan.”

Não inventar formação complementar.

Não inventar certificação.

Não inventar prêmio.

Não inventar LinkedIn.

Adicionar link:

“Conheça a história de Daniel e da Lardan”

→ `/a-lardan`

==================================================
12. DATA E RESPONSABILIDADE EDITORIAL
=====================================

Cada artigo deve mostrar:

Publicado em: 17 de setembro de 2026

Atualizado em:
usar data real quando houver atualização editorial.

Não fingir atualização automática diária.

Se o conteúdo não mudou, não alterar `dateModified` simplesmente para parecer recente.

Mostrar:

Tempo estimado de leitura.

Pode ser calculado com base no conteúdo.

==================================================
13. SCHEMA DE AUTORIA
=====================

Criar suporte adequado a:

Article

com:

headline
description
url
mainEntityOfPage
datePublished
dateModified
inLanguage
author
publisher
about
articleSection

Author:

`@id: SITE_URL/#daniel`

Publisher:

`@id: SITE_URL/#organization`

Reutilizar o Person existente.

Não duplicar Daniel como várias pessoas diferentes no grafo.

==================================================
14. SCHEMAS POR ARTIGO
======================

Usar apenas schemas coerentes com conteúdo visível.

Cada página:

* WebPage;
* Article;
* BreadcrumbList;
* FAQPage quando FAQ estiver visível;
* Organization referenciada;
* Person Daniel referenciado.

NÃO usar Product para artigo.

NÃO usar Review.

NÃO inventar AggregateRating.

NÃO inventar avaliação.

NÃO usar JobPosting para consultora.

NÃO usar HowTo somente para tentar rich result.

Se houver estrutura passo a passo, Article + HTML semântico já é suficiente.

==================================================
15. EXPERIÊNCIA VISUAL
======================

Esses conteúdos NÃO podem parecer:

blog WordPress genérico;
portal de notícias;
landing page de afiliado;
página feita para Adsense;
texto infinito sem design.

Precisam parecer:

LARDAN.

Editorial premium.

Luxo contemporâneo.

Limpo.

Muito branco/respiro.

Fotografia forte.

Joias.

Mulheres reais.

Família quando contextualmente adequado.

Produto.

Tecnologia.

Tipografia já existente.

Preservar identidade visual atual.

==================================================
16. ESTRUTURA VISUAL PADRÃO
===========================

Cada artigo deve possuir:

Hero editorial

Breadcrumb visual

Eyebrow

H1

Subheadline

Informações de autoria

Data

Tempo de leitura

Resposta direta inicial

Índice do conteúdo

Conteúdo editorial

Blocos de pergunta direta

Tabelas

Destaques

Fotografia/editorial

CTA contextual

FAQ

Autor

Fontes e referências

Próximos conteúdos

CTA final

Footer atual.

==================================================
17. NÃO EXAGERAR CTA
====================

Não quero botão Lardan a cada três parágrafos.

Cada página deve ensinar primeiro.

CTA aparece quando semanticamente apropriado.

Hierarquia:

CTA editorial
→ próximo artigo

CTA comercial leve
→ `/seja-lardan`

CTA comercial forte
→ próximo ao final.

==================================================
18. COPY COMERCIAL
==================

Pode usar:

“Conheça a oportunidade de ser Consultora Lardan”

“Veja como funciona ser Consultora Lardan”

“Conheça a estrutura que a Lardan oferece à consultora”

“Revenda semijoias Lardan com 2 anos de garantia”

“Quero conhecer a Lardan”

“Quero me candidatar”

NÃO publicar como fato:

“A melhor semijoia do Brasil”

sem comprovação independente adequada.

Podemos transmitir excelência sem alegação absoluta.

==================================================
19. NÃO PROMETER RENDA
======================

Proibido:

“Ganhe R$ 5.000”
“Renda garantida”
“Lucro garantido”
“Mude de vida em 30 dias”
“Trabalhe pouco”
“Fique rica”
“Liberdade financeira garantida”
“Sem risco”

Resultado depende de:

vendas;
rotina;
clientes;
execução;
condições comerciais;
mercado.

==================================================
20. NÃO VITIMIZAR A MULHER
==========================

O conteúdo pode falar sobre:

família;
filhos;
contas;
renda;
tempo;
autonomia;
trabalho.

Mas não usar linguagem:

“mulher guerreira”
“ajude seu marido”
“mãe desesperada”
“você precisa salvar sua família”

Tratar a leitora como adulta.

==================================================
21. FAMÍLIA COMO DNA DA LARDAN
==============================

A família deve estar presente porque faz parte da história REAL da empresa.

Daniel atuou por 15 anos no universo da venda consignada.

Com a chegada da primeira filha e uma rotina intensa de viagens, Daniel e Larissa decidiram construir algo próprio que permitisse mais presença e construção de legado.

Essa história pode aparecer de forma breve nos artigos.

Frase editorial permitida:

“Eu sei que uma decisão profissional muitas vezes também é uma decisão familiar. A própria Lardan nasceu assim.”

Daniel pode assinar essa ideia.

Não inventar aspas como declaração histórica se não houver uma citação oficial.

==================================================
22. PONTUAÇÃO EDITORIAL
=======================

IMPORTANTE.

NÃO usar travessões “—” como vício estilístico em todos os parágrafos.

Preferir:

ponto;
vírgula;
dois-pontos;
ponto e vírgula;
parênteses quando necessário.

O conteúdo deve parecer escrito por uma pessoa, não por um padrão repetitivo de IA.

==================================================
23. FONTES
==========

Dados externos precisam ter fonte.

NÃO inventar número.

NÃO inventar volume mensal de busca.

NÃO dizer:

“50 mil mulheres pesquisam por mês”

sem uma fonte verificável.

As pesquisas de mercado recebidas alertam que os volumes exatos NÃO foram confirmados por exportação do Google Keyword Planner.

Logo:

NÃO PUBLICAR VOLUME DE KEYWORD.

==================================================
24. FONTES PRIMÁRIAS/CONFIÁVEIS PARA UTILIZAR
=============================================

Fonte 1

IBGE
Trabalho por conta própria / mercado de trabalho 2025

https://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/45761-desocupacao-cai-para-5-1-em-dezembro-e-2025-tem-melhores-resultados-da-serie-historica

Dado utilizável:

Em 2025, o Brasil registrou aproximadamente 26,1 milhões de trabalhadores por conta própria.

Sempre contextualizar que é dado geral da população ocupada, não exclusivamente feminino.

Fonte 2

IBGE
Mercado de trabalho por sexo em 2025

https://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/45923-em-2025-vinte-unidades-da-federacao-registram-a-menor-taxa-de-desocupacao-da-serie

Dado utilizável:

No quarto trimestre de 2025, a desocupação feminina foi de 6,2%, contra 4,2% entre os homens.

Não afirmar causalidade direta com busca por renda extra.

Fonte 3

DataReportal
Digital 2026 Brazil

https://datareportal.com/reports/digital-2026-brazil

Dado utilizável:

O Instagram possuía audiência adulta brasileira com participação feminina relevante no fim de 2025.

Se utilizar número específico de 57,1%, citar diretamente essa fonte.

Isso sustenta importância do Instagram como canal, não prova perfil de compradora de semijoias.

Fonte 4

Portal do Empreendedor / Governo Federal

Usar apenas para orientação geral sobre formalização/MEI quando necessário.

Não prestar aconselhamento jurídico ou tributário individual.

Fonte 5

Página oficial da Lardan

Dados sobre:

* marca;
* garantia;
* consultoria;
* fundadores;
* estrutura;
* produtos;

devem usar páginas oficiais da própria Lardan como fonte primária.

==================================================
25. PÁGINA 1
============

URL:

`/renda-extra-com-vendas`

TITLE:

`Renda Extra com Vendas: Como Começar com Mais Clareza | Lardan`

DESCRIPTION:

`Precisa aumentar sua renda? Entenda como começar com vendas, escolher o que vender, conciliar sua rotina e avaliar opções como a revenda de semijoias.`

H1:

# Renda extra com vendas: como começar sem perder de vista sua rotina e sua família

EYEBROW:

GUIA LARDAN

SUBHEADLINE:

`Antes de escolher o que vender, vale entender quanto tempo você tem, quanto pode investir, para quem poderia vender e que tipo de negócio combina com a sua vida.`

AUTOR:

Daniel de Freitas Maciel
Fundador e CEO da Lardan

==================================================
26. CONTEÚDO COMPLETO — PÁGINA 1
================================

### ABERTURA

Se você chegou até aqui pesquisando como aumentar sua renda, provavelmente não está procurando apenas uma lista com “ideias para ganhar dinheiro”.

Talvez queira contribuir mais com as despesas da casa.

Talvez queira ter o seu próprio dinheiro.

Talvez esteja procurando uma atividade que possa conciliar com filhos, trabalho, estudos ou outras responsabilidades.

Ou talvez queira começar algo que seja realmente seu.

Não existe uma única resposta que funcione para todo mundo.

Antes de escolher uma atividade, é importante olhar para a sua realidade: quanto tempo você tem, quanto dinheiro pode investir, quais pessoas já fazem parte da sua rede de relacionamento, que habilidades possui e quanto risco está disposta a assumir.

Vendas podem ser uma alternativa de renda extra porque não exigem, necessariamente, uma loja física ou uma jornada tradicional.

Mas vender também exige organização, relacionamento, consistência e responsabilidade.

Este guia foi criado para ajudar você a pensar antes de começar.

### RESPOSTA DIRETA

## Sou mãe e preciso aumentar minha renda. O que posso fazer?

Comece olhando para três recursos que você já possui: tempo disponível, habilidades e relacionamentos.

Se você tem poucas horas por dia, uma atividade flexível pode fazer mais sentido do que uma segunda jornada rígida.

Se gosta de conversar, atender pessoas e indicar produtos, vendas podem ser uma possibilidade.

O importante é não começar apenas pela promessa de ganho.

Pergunte:

Quanto consigo dedicar por semana?

Preciso investir dinheiro antes de vender?

Tenho onde guardar estoque?

Consigo atender clientes pelo celular?

A empresa fornece produto, suporte e garantia?

Como vou organizar o dinheiro das vendas?

Responder essas perguntas é mais importante do que encontrar uma lista de “rendas extras mais lucrativas”.

### CONTEXTO SÉRIO

## Buscar uma segunda fonte de renda faz parte de uma transformação maior do trabalho no Brasil

Segundo o IBGE, o Brasil alcançou aproximadamente 26,1 milhões de trabalhadores por conta própria em 2025.

Isso não significa que 26 milhões de pessoas estejam procurando renda extra, nem que sejam todas mulheres.

O dado mostra, porém, como trabalhar por conta própria ocupa um espaço importante no mercado brasileiro.

Outro dado do IBGE mostra que, no quarto trimestre de 2025, a taxa de desocupação entre mulheres era de 6,2%, enquanto entre homens era de 4,2%.

Dados como esses ajudam a entender o contexto econômico, mas nenhuma estatística explica sozinha a decisão de uma pessoa.

Por trás de uma busca por “renda extra” existe uma vida real.

### PERGUNTA

## Quero ajudar nas despesas de casa, mas não posso trabalhar fora o dia todo. O que devo avaliar?

Primeiro, não procure apenas “o que dá mais dinheiro”.

Procure o que é compatível com a sua rotina.

Avalie:

tempo disponível;
necessidade ou não de deslocamento;
investimento inicial;
risco de estoque;
facilidade de vender pelo celular;
necessidade de experiência;
recorrência de clientes;
suporte oferecido;
qualidade do produto;
garantia;
organização financeira.

Um negócio que parece excelente no papel pode ser inviável se exigir horários que você não possui.

Da mesma forma, uma atividade simples pode ganhar força quando cabe na sua rotina e permite constância.

### PERGUNTA

## Como ter renda extra trabalhando algumas horas por dia?

Algumas atividades podem ser realizadas em blocos menores de tempo.

Vendas por relacionamento são um exemplo.

Você pode separar momentos diferentes para:

responder clientes;
mostrar produtos;
publicar novidades;
realizar entregas;
registrar vendas;
fazer pós-venda;
organizar recebimentos.

Isso não significa trabalhar “sem esforço”.

Significa organizar a atividade em torno de uma rotina possível.

### PERGUNTA

## O que posso vender sem precisar investir muito?

Antes de escolher o produto, compare modelos.

Existem negócios em que você compra estoque antecipadamente.

Existem modelos sob encomenda.

Existem serviços.

Existem programas de afiliados.

Existem modelos de consignação.

Na consignação, o produto é disponibilizado para venda conforme regras definidas entre empresa e consultora, reduzindo a necessidade de comprar antecipadamente todo o estoque.

Isso não significa automaticamente “zero custo” ou “zero responsabilidade”.

Contrato, prazos, responsabilidade pelas peças, forma de acerto e demais condições precisam ser compreendidos antes da entrada.

### BLOCO EDITORIAL

## O melhor produto para vender é aquele que você entende e consegue apresentar com confiança

Observe cinco pontos:

### 1. É fácil de demonstrar?

Produtos visuais podem ser apresentados pessoalmente, por foto, vídeo, Status ou Instagram.

### 2. Existe recompra?

Produtos ligados a estilo, presente e uso pessoal podem gerar novas oportunidades de relacionamento.

### 3. O produto possui qualidade e garantia?

Você coloca seu nome na frente da cliente.

Uma venda ruim afeta também a sua reputação.

### 4. Existe suporte?

Começar sozinha é diferente de começar com orientação, tecnologia e estrutura.

### 5. O risco financeiro é compatível com você?

Comprar grande quantidade sem saber se conseguirá vender pode ser inadequado para quem está começando.

### PERGUNTA

## O que posso vender para minhas amigas e conhecidas?

Comece pensando menos em “empurrar produtos” e mais em resolver interesses reais.

Moda, beleza e acessórios funcionam bem em vendas relacionais porque podem ser demonstrados naturalmente.

Semijoias possuem uma característica importante: a cliente consegue ver, experimentar, comparar e imaginar a peça no próprio estilo.

Mas relacionamento precisa vir antes da insistência.

Vender para conhecidas não significa mandar catálogo para todos os contatos.

Significa aprender a identificar interesse.

### PERGUNTA

## Qual produto é bom para vender pelo WhatsApp?

Produtos visuais, que possam ser explicados com fotos, vídeos curtos e informações objetivas, tendem a se adaptar bem ao WhatsApp.

O canal também é útil para:

tirar dúvidas;
mostrar opções;
avisar novidades;
fazer pós-venda;
lembrar ocasiões;
manter relacionamento.

O Instagram pode ajudar na descoberta.

O WhatsApp pode ajudar na conversa e no relacionamento.

No fim de 2025, o Instagram possuía presença feminina relevante entre sua audiência adulta brasileira, segundo o DataReportal.

Isso não significa que toda mulher esteja interessada em vender semijoias.

Significa apenas que canais digitais já fazem parte do cotidiano do público brasileiro.

### TRANSIÇÃO PARA SEMIJOIAS

## E as semijoias? Podem ser uma alternativa para renda extra?

Podem.

Principalmente para quem gosta de relacionamento, moda, atendimento e vendas visuais.

Mas a decisão precisa considerar:

qualidade;
garantia;
modelo comercial;
necessidade de estoque;
suporte;
comissão;
regras;
trocas;
tecnologia;
organização.

Uma semijoia bonita pode abrir uma conversa.

Uma estrutura boa ajuda a transformar aquela conversa em negócio.

### CTA CONTEXTUAL

Título:

`Pensando em começar com semijoias?`

Texto:

`Antes de se cadastrar em qualquer empresa, entenda como a venda de semijoias funciona na prática.`

Botão:

`Como começar a vender semijoias`

→ `/como-comecar-a-vender-semijoias`

### BLOCO LARDAN

## Na Lardan, produto e tecnologia trabalham juntos

Uma Consultora Lardan não recebe apenas peças para apresentar.

Ela conta com a estrutura digital do Lardan OS para organizar sua operação.

Apresentar, de acordo com os recursos realmente disponíveis:

CRM;
carteira de clientes;
vitrine digital;
registro de vendas;
acompanhamento financeiro;
metas;
treinamentos;
ferramentas de relacionamento.

As semijoias Lardan possuem 2 anos de garantia, conforme as condições oficiais da marca.

### CTA COMERCIAL LEVE

`Conheça a oportunidade de ser Consultora Lardan`

→ `/seja-lardan`

### DANIEL / FAMÍLIA

## Uma empresa que também nasceu de uma decisão familiar

Texto:

“Eu sei que uma decisão profissional muitas vezes também é uma decisão familiar. A própria Lardan nasceu assim.”

Depois explicar SEM INVENTAR:

Daniel já trabalhava há 15 anos com venda consignada.

Com a chegada da primeira filha e uma rotina constante de viagens, Daniel e Larissa decidiram construir algo próprio.

Essa decisão deu origem à Lardan.

Link:

`Conheça nossa história`

→ `/a-lardan`

==================================================
27. FAQ PÁGINA 1
================

Criar FAQ visível respondendo:

1. O que posso fazer para aumentar minha renda?
2. É possível ter renda extra trabalhando poucas horas?
3. O que posso vender para ter renda extra?
4. O que vender para amigas e conhecidas?
5. O que posso vender pelo WhatsApp?
6. Preciso comprar estoque para começar a vender?
7. O que é venda consignada?
8. Semijoias podem ser uma opção de renda extra?
9. Preciso ter experiência com vendas?
10. Como separar o dinheiro das vendas das contas da casa?
11. Como escolher uma empresa para revender produtos?
12. Como funciona para ser Consultora Lardan?

Respostas entre 60 e 140 palavras quando necessário.

Não responder com frases vazias.

==================================================
28. PÁGINA 2
============

URL:

`/como-comecar-a-vender-semijoias`

TITLE:

`Como Começar a Vender Semijoias do Zero: Guia Completo | Lardan`

DESCRIPTION:

`Quer vender semijoias? Veja como começar do zero, encontrar clientes, vender pelo WhatsApp, escolher uma empresa e organizar suas vendas.`

H1:

# Como começar a vender semijoias do zero: um guia para quem quer fazer direito

SUBHEADLINE:

`Produto, clientes, WhatsApp, garantia, organização e relacionamento: entenda o que realmente importa antes da primeira venda.`

==================================================
29. CONTEÚDO COMPLETO — PÁGINA 2
================================

### ABERTURA

Vender semijoias parece simples quando vemos apenas a parte mais bonita do negócio: abrir uma maleta, mostrar uma peça e fazer uma venda.

Na prática, construir uma carteira de clientes exige mais.

Você precisa conhecer o produto.

Precisa saber ouvir.

Precisa aprender a apresentar.

Precisa lembrar quem comprou.

Precisa acompanhar pagamentos.

Precisa fazer pós-venda.

E precisa cuidar do relacionamento para que uma venda não termine quando a cliente leva a peça.

A boa notícia é que você não precisa saber tudo antes de começar.

Precisa começar com estrutura e disposição para aprender.

### PERGUNTA PRINCIPAL

## Vale a pena vender semijoias?

Pode valer a pena para quem se identifica com vendas, relacionamento e moda/acessórios.

A decisão não deve depender apenas de uma promessa de comissão.

Antes de começar, avalie:

qualidade das peças;
garantia;
modelo comercial;
responsabilidade por estoque;
comissão;
forma de pagamento;
trocas;
suporte;
tecnologia;
treinamento;
reputação da empresa.

O melhor modelo não é necessariamente o que promete o maior percentual.

É aquele cujas regras você compreende e consegue executar.

### PERGUNTA

## Como começar a vender semijoias do zero?

Comece nesta ordem:

1. Entenda o modelo comercial.
2. Conheça o produto.
3. Defina quem pode ser seu primeiro público.
4. Organize seus contatos.
5. Aprenda a apresentar sem pressionar.
6. Registre todas as vendas.
7. Separe vendas de recebimentos.
8. Faça pós-venda.
9. Peça indicações quando houver satisfação.
10. Revise o que vendeu e o que suas clientes preferem.

Não precisa parecer uma grande empresa no primeiro dia.

Precisa evitar desorganização desde o primeiro dia.

### PERGUNTA

## Preciso ter experiência com vendas?

Não necessariamente.

Mas precisa estar disposta a aprender.

Venda de relacionamento envolve:

escuta;
apresentação;
organização;
acompanhamento;
confiança;
pós-venda.

Quem nunca vendeu pode desenvolver essas habilidades.

### BLOCO

## Como fazer as primeiras vendas de semijoias

Não comece enviando uma mensagem genérica para centenas de pessoas.

Comece pela sua rede próxima.

Pense em:

amigas;
colegas;
vizinhas;
familiares;
colegas de trabalho;
pessoas da faculdade;
pessoas que já pedem sua opinião sobre moda;
contatos que gostam de acessórios.

O objetivo não é pressionar.

É informar que você começou uma nova atividade e permitir que as pessoas demonstrem interesse.

### EXEMPLO

Mensagem possível:

“Oi, [nome]. Comecei uma nova atividade com semijoias e lembrei de você porque sempre conversamos sobre acessórios. Quando quiser, posso te mostrar algumas peças que combinam com o seu estilo. Sem compromisso.”

Não automatizar envio indiscriminado.

Não fazer spam.

### PERGUNTA

## Preciso ter loja para vender semijoias?

Não.

Semijoias podem ser apresentadas presencialmente e por canais digitais.

Uma consultora pode combinar:

maleta;
WhatsApp;
Instagram;
vitrine digital;
indicação;
atendimento individual.

O importante é que informações como preço, garantia e condições sejam apresentadas de forma clara.

### PERGUNTA

## Como conseguir clientes para semijoias?

Sua primeira carteira costuma nascer de relacionamento.

Mas ela não pode parar aí.

Quatro fontes podem trabalhar juntas:

rede próxima;
indicação;
conteúdo nas redes;
reativação de clientes.

Depois de uma venda bem-feita:

faça pós-venda;
registre preferência;
lembre datas importantes;
mostre novidades coerentes;
peça indicação quando houver satisfação.

### PERGUNTA

## Como perder a vergonha de vender?

Troque a ideia de “convencer alguém” por “ajudar alguém a escolher”.

Você não precisa abordar todo mundo.

Não precisa transformar cada conversa em venda.

Conheça o produto e faça boas perguntas.

Exemplos:

“Você prefere dourado ou prata?”

“Usa peças mais delicadas ou gosta de destaque?”

“Está procurando para você ou para presente?”

“Existe alguma faixa de preço que você prefere?”

Isso torna a conversa consultiva.

### BLOCO DE QUALIDADE

## Sua reputação acompanha a peça que você vende

Quando você indica um produto, a cliente associa aquela experiência a você.

Por isso, qualidade e garantia importam.

A Lardan oferece 2 anos de garantia em suas semijoias, conforme as condições oficiais.

A consultora precisa conhecer essas condições e explicar corretamente à cliente.

Não prometer cobertura além da garantia real.

### PERGUNTA

## Como organizar minhas clientes?

Aqui existe uma diferença enorme entre simplesmente vender e construir uma carteira.

Você precisa lembrar:

quem comprou;
o que comprou;
quando comprou;
preferências;
estilo;
faixa de preço;
aniversário;
último contato;
última compra;
oportunidades de pós-venda.

É exatamente por isso que a Consultora Lardan tem CRM.

O CRM ajuda a transformar memória em informação organizada.

### BLOCO TECNOLOGIA

## Uma Consultora Lardan não administra o negócio apenas pelo bloco de notas

Apresentar o Lardan OS no PRESENTE.

Explicar recursos efetivamente disponíveis:

CRM;
carteira de clientes;
vitrine;
maleta;
vendas;
recebimentos;
financeiro pessoal;
metas;
treinamentos;
campanhas.

Não inventar funcionalidade adicional.

### PERGUNTA

## Como separar dinheiro das vendas do dinheiro de casa?

O primeiro princípio é simples:

venda não significa automaticamente dinheiro disponível.

Pode existir:

valor vendido;
valor recebido;
valor a receber;
valor devido;
resultado.

Misturar tudo dificulta saber se a atividade está funcionando.

A organização financeira da consultora existe para trazer clareza sobre esses movimentos.

Não transformar esse trecho em aconselhamento financeiro.

### CTA

`Entenda como funciona a revenda consignada de semijoias`

→ `/semijoias-consignadas-para-revenda`

### SEGUNDO CTA

`Quero conhecer a estrutura da Consultora Lardan`

→ `/seja-lardan`

==================================================
30. FAQ PÁGINA 2
================

Responder:

1. Como começar a vender semijoias do zero?
2. Vender semijoias vale a pena?
3. Preciso ter experiência?
4. Preciso de loja?
5. Como conseguir as primeiras clientes?
6. Como vender semijoias para amigas sem ser inconveniente?
7. Como vender pelo WhatsApp?
8. Preciso ter Instagram?
9. Como escolher semijoias de qualidade?
10. Qual a importância da garantia?
11. Como organizar clientes?
12. Como controlar vendas e recebimentos?
13. Preciso abrir CNPJ?
14. Como escolher uma empresa de semijoias para revender?
15. Como funciona ser Consultora Lardan?

Quando falar de CNPJ:

fornecer orientação geral e direcionar a fontes oficiais.

Não dar parecer tributário individual.

==================================================
31. PÁGINA 3
============

URL:

`/semijoias-consignadas-para-revenda`

TITLE:

`Semijoias Consignadas para Revenda: Entenda Como Funciona | Lardan`

DESCRIPTION:

`Entenda a revenda consignada de semijoias: maleta, estoque, acerto, peças não vendidas, garantia, responsabilidades e o que avaliar antes de começar.`

H1:

# Semijoias consignadas para revenda: entenda como funciona antes de começar

SUBHEADLINE:

`Consignação pode reduzir a necessidade de comprar estoque antecipadamente, mas exige regras claras. Saiba o que perguntar antes de aceitar uma maleta.`

==================================================
32. CONTEÚDO COMPLETO — PÁGINA 3
================================

### ABERTURA

Uma das maiores dúvidas de quem pensa em revender semijoias é simples:

“Preciso comprar uma grande quantidade de peças antes de saber se vou conseguir vender?”

É justamente aqui que surge o modelo consignado.

Na consignação, a consultora recebe produtos para comercializar conforme as regras acordadas com a empresa.

O modelo pode reduzir a necessidade de comprar antecipadamente todo o estoque.

Mas consignado não significa “produto sem responsabilidade”.

Antes de começar, você precisa compreender:

quem é responsável pelas peças;
prazo;
acerto;
devolução;
pagamento;
troca;
garantia;
perdas;
contrato;
comissão;
reposição;
análise cadastral.

Esta página existe para explicar as perguntas que precisam ser feitas antes do cadastro.

### RESPOSTA DIRETA

## O que são semijoias consignadas?

São peças disponibilizadas para venda dentro de uma relação comercial em que a consultora não necessariamente compra todo o conjunto antecipadamente.

A empresa fornece os produtos conforme suas regras comerciais.

A consultora apresenta as peças, registra vendas e posteriormente realiza o acerto conforme o contrato e o modelo utilizado.

As condições variam entre empresas.

Por isso, nunca escolha uma oportunidade apenas porque viu a frase:

“sem investimento”.

Leia as condições.

### COMPARATIVO

## Consignação ou comprar semijoias no atacado?

Criar tabela.

COLUNAS:

Critério
Consignação
Compra no atacado

LINHAS:

Compra inicial do estoque
Risco de peças paradas
Liberdade sobre estoque
Responsabilidade pelas peças
Capital necessário
Margem/comissão
Troca de peças
Prazo
Acerto
Suporte

IMPORTANTE:

Tabela precisa ser neutra.

Não fazer Lardan “ganhar” artificialmente todos os critérios.

Conclusão:

Comprar estoque pode fazer sentido para quem possui capital, conhece sua demanda e deseja assumir integralmente o risco e a gestão do estoque.

Consignação pode fazer sentido para quem prefere começar com menor exposição a uma compra inicial de estoque, desde que compreenda as responsabilidades contratuais.

### PERGUNTA

## O que acontece se eu não vender todas as peças?

Depende das regras da empresa.

Antes de aceitar uma maleta, pergunte:

posso devolver peças não vendidas?
existe período mínimo?
há regra de troca?
quem paga o transporte?
qual é o prazo para acerto?
existem metas?
qual é a responsabilidade em caso de dano ou perda?

Para a Lardan, publicar SOMENTE as regras oficiais que estiverem confirmadas no projeto.

Não usar “42 dias” como regra pública apenas porque apareceu como exemplo técnico em documentação antiga.

Não inventar prazo.

### PERGUNTA

## Preciso investir para vender semijoias consignadas?

Não responder genericamente:

“Não.”

Explique:

Consignação reduz a necessidade de comprar antecipadamente todo o estoque, mas cada empresa define regras próprias.

Pode haver custos, caução, transporte, responsabilidade por peças, contrato ou outras condições.

Na Lardan, mostrar apenas aquilo que estiver oficialmente configurado e aprovado para comunicação pública.

### PERGUNTA

## Existe análise para receber uma maleta?

Empresas podem realizar análise antes de entregar produtos consignados porque existe patrimônio sob responsabilidade de terceiros.

Na Lardan, a entrada começa por uma candidatura.

Depois:

análise;
conversa;
aprovação;
onboarding;
primeira maleta;
ativação.

Não prometer aprovação.

### PERGUNTA

## Preciso ter CNPJ?

Não dar resposta jurídica universal se o regime da operação não tiver sido validado para todos os cenários.

Explicar que formalização depende da natureza e estágio da atividade e que orientações tributárias devem ser confirmadas em canais oficiais como Portal do Empreendedor, contador ou autoridade competente.

Para ser candidata à Lardan, utilizar somente requisitos reais do cadastro atual.

### PERGUNTA

## Como funciona o acerto de uma maleta consignada?

Explicar genericamente:

A consultora registra as vendas.

A empresa identifica produtos vendidos e produtos que continuam sob responsabilidade.

O acerto financeiro segue as condições contratuais.

Produtos não vendidos seguem a regra definida para devolução, permanência ou troca.

Na Lardan, o Lardan OS organiza a rastreabilidade dessa operação.

Não inventar valores, prazo ou percentual.

### PERGUNTA

## O que acontece se uma peça for perdida?

Depende do contrato.

Toda candidata deve compreender a responsabilidade sobre produtos recebidos antes de aceitar uma maleta.

Não suavizar esse risco.

Transparência gera mais confiança do que esconder regra difícil.

### PERGUNTA

## As peças possuem garantia?

Na Lardan:

SIM.

As semijoias Lardan possuem 2 anos de garantia, conforme as condições oficiais da marca.

Criar link contextual para a informação oficial de garantia quando a página dedicada existir.

Enquanto não existir, apontar para a fonte pública correta que contenha essa informação.

### PERGUNTA

## Quanto uma revendedora de semijoias pode ganhar?

Não existe um valor universal.

O resultado depende de:

quantidade vendida;
modelo comercial;
comissão/margem;
clientes;
recebimento;
despesas;
tempo;
frequência.

Nunca confundir:

venda;
faturamento;
comissão;
recebimento;
resultado.

Não publicar simulação falsa da Lardan.

Se futuramente existir calculadora com regras oficiais, utilizar parâmetros configurados.

### BLOCO DIFERENCIAL

## Consignação resolve o estoque. Organização ajuda a resolver o restante.

Receber uma maleta não ensina automaticamente a:

conseguir clientes;
lembrar preferências;
fazer pós-venda;
controlar recebimentos;
acompanhar vendas;
organizar metas.

Por isso, o diferencial da Lardan não está apenas nas peças.

Está também na estrutura.

Apresentar o Lardan OS.

No PRESENTE.

### CHECKLIST

## 12 perguntas para fazer antes de aceitar qualquer maleta consignada

1. Preciso comprar alguma peça?
2. Existe caução?
3. Existe taxa?
4. Quem responde por perda?
5. Quem responde por dano?
6. Qual é o prazo do ciclo?
7. Como funciona o acerto?
8. Posso devolver o que não vender?
9. Como funciona a troca?
10. Qual é a garantia?
11. Existe suporte e treinamento?
12. Como vou controlar clientes, vendas e recebimentos?

Depois:

“Uma empresa séria precisa conseguir responder essas perguntas com clareza.”

### CTA

`Veja como funciona ser Consultora Lardan`

→ `/seja-lardan`

### CTA SECUNDÁRIO

`Aprenda como começar a vender semijoias`

→ `/como-comecar-a-vender-semijoias`

==================================================
33. FAQ PÁGINA 3
================

Responder:

1. O que é consignação de semijoias?
2. Como funciona uma maleta consignada?
3. Preciso comprar estoque?
4. Existe investimento inicial?
5. O que acontece com peças não vendidas?
6. Existe caução?
7. Existe contrato?
8. Quem responde por peça perdida?
9. Como funciona o acerto?
10. Existe meta?
11. Posso devolver peças?
12. Posso trocar peças?
13. Quanto ganha uma revendedora?
14. Preciso ter CNPJ?
15. Posso vender pelo WhatsApp?
16. Posso vender pelo Instagram?
17. As semijoias possuem garantia?
18. Como saber se uma empresa de consignação é confiável?
19. Como funciona a candidatura Lardan?
20. Como solicitar informações sobre uma maleta Lardan?

==================================================
34. PÁGINA 4
============

URL:

`/como-vender-semijoias-pelo-whatsapp`

TITLE:

`Como Vender Semijoias pelo WhatsApp sem Ser Inconveniente | Lardan`

DESCRIPTION:

`Aprenda a vender semijoias pelo WhatsApp: abordagem, Status, clientes, pós-venda, cobrança, catálogo e organização para vender com relacionamento.`

H1:

# Como vender semijoias pelo WhatsApp sem ser inconveniente

SUBHEADLINE:

`WhatsApp não precisa ser panfletagem. Quando usado com relacionamento e organização, ele pode ajudar você a apresentar peças, atender, vender e fazer pós-venda.`

==================================================
35. CONTEÚDO COMPLETO — PÁGINA 4
================================

### ABERTURA

O WhatsApp provavelmente já faz parte da sua rotina.

É onde estão familiares, amigas, colegas de trabalho, clientes, grupos e contatos construídos ao longo dos anos.

Isso não significa que todos esses contatos querem receber ofertas.

O primeiro princípio para vender bem pelo WhatsApp é simples:

Relacionamento antes da insistência.

Você não precisa enviar 30 fotos para todas as pessoas.

Precisa identificar interesse e atender melhor quem demonstra vontade de comprar.

### RESPOSTA DIRETA

## Como começar a vender semijoias pelo WhatsApp?

Comece organizando três coisas:

seu perfil;
seus contatos;
sua forma de apresentar as peças.

Tenha uma foto profissional ou adequada.

Identifique-se claramente.

Separe informações sobre:

produto;
preço;
garantia;
pagamento;
entrega.

Depois, em vez de disparar mensagens genéricas, comece com pessoas que já possuem algum relacionamento com você.

### PERGUNTA

## O que mandar para minhas amigas quando eu começar?

Não transforme amizade em pressão comercial.

Exemplo:

“Oi, [nome]. Comecei uma nova atividade com semijoias e estou montando minha primeira carteira de clientes. Lembrei de você porque sei que gosta de acessórios. Quando quiser, posso te mostrar algumas opções que combinam com seu estilo. Sem compromisso.”

Criar botão:

COPIAR MENSAGEM

Esse botão copia somente o texto.

Não enviar automaticamente.

### PERGUNTA

## Como vender no Status sem parecer panfletagem?

Seu Status pode alternar:

produto;
detalhe;
combinação;
novidade;
bastidor;
dica;
garantia;
presente;
depoimento real quando autorizado.

Não publique 40 imagens quase idênticas de uma só vez.

Mostre seleção.

Uma peça.

Uma composição.

Uma pergunta.

Um benefício.

Depois permita que a cliente responda.

### EXEMPLOS DE STATUS

“Dourado ou prata: qual combina mais com você?”

“Chegaram peças novas hoje. Separei três das minhas favoritas.”

“Presente sem erro: quer que eu te mostre opções dentro da sua faixa de preço?”

“Essa peça tem 2 anos de garantia Lardan. Quer ver detalhes?”

Não afirmar condição além das regras oficiais.

### PERGUNTA

## Preciso usar WhatsApp Business?

Não é obrigatório para conversar com uma cliente.

Mas ferramentas de organização disponíveis no WhatsApp Business podem ajudar na rotina comercial.

Quando falar de funcionalidades atuais do WhatsApp, conferir documentação oficial antes de publicar.

Não inventar recurso.

### PERGUNTA

## Como abordar sem ser chata?

Não comece oferecendo.

Comece entendendo.

Pergunte:

“Você prefere dourado ou prata?”

“Gosta de peças discretas ou maiores?”

“É para você ou presente?”

“Tem alguma faixa de preço em mente?”

A cliente deixa de receber um catálogo aleatório.

Passa a receber uma seleção.

### BLOCO

## Três opções costumam ser melhores do que cinquenta fotos

Um problema comum de vendas pelo celular é excesso.

Se a cliente diz:

“Quero um brinco delicado e dourado.”

Não mande o catálogo inteiro.

Selecione algumas opções coerentes.

A curadoria faz parte do atendimento.

### PERGUNTA

## Como vender para pessoas que não são minhas amigas?

Depois das primeiras vendas:

faça pós-venda;
construa indicação;
publique conteúdo;
mostre produto;
atenda bem;
peça recomendação quando fizer sentido.

Uma carteira cresce quando clientes satisfeitas apresentam você a novas pessoas.

### PERGUNTA

## Como cobrar uma cliente sem perder a amizade?

Primeiro:

não deixe regras para depois.

Combine:

valor;
forma de pagamento;
data;
parcelamento;
entrega.

Se houver atraso:

seja objetiva;
educada;
profissional;
registre o combinado.

Exemplo:

“Oi, [nome]. Tudo bem? Passando para lembrar que o pagamento de R$ [valor], combinado para [data], ainda aparece como pendente para mim. Você consegue me confirmar quando consegue regularizar? Se já pagou, pode desconsiderar e me enviar o comprovante.”

Botão:

COPIAR MENSAGEM

Não automatizar cobrança.

Não disparar.

### PERGUNTA

## Como organizar minhas clientes no WhatsApp?

WhatsApp é excelente para conversar.

Mas conversa não é CRM.

Se sua carteira crescer, você precisa lembrar:

o que cada pessoa gosta;
última compra;
aniversário;
faixa de preço;
preferências;
último contato;
histórico.

### TRANSIÇÃO LARDAN

## É aqui que o CRM da Consultora Lardan faz diferença

A Consultora Lardan tem uma estrutura própria para organizar clientes e relacionamento.

Mostrar, com dados reais disponíveis:

clientes;
preferências;
histórico;
aniversários;
última compra;
frequência;
vendas.

Não inventar print fake.

Se já houver interface utilizável, criar mockup REAL a partir do sistema.

Não expor dados pessoais reais.

Usar dados fictícios claramente demonstrativos.

### BLOCO

## WhatsApp aproxima. CRM organiza.

Criar visual comparativo:

WHATSAPP

Conversa
Apresentação
Atendimento
Negociação
Pós-venda

CRM LARDAN

Histórico
Preferências
Clientes
Datas
Compras
Organização
Próximas oportunidades

Não colocar os dois como concorrentes.

São complementares.

### PERGUNTA

## Como fazer pós-venda de semijoias?

Alguns dias depois:

pergunte se deu tudo certo;
confirme se a cliente gostou;
relembre cuidados;
deixe a garantia clara;
registre preferência.

Não use pós-venda apenas para tentar vender imediatamente outra peça.

### PERGUNTA

## Como conseguir novas indicações?

Depois de uma boa experiência:

“Fico feliz que tenha gostado. Se lembrar de alguém que também goste desse estilo, pode me apresentar. Vou atender com o mesmo cuidado.”

Indicação precisa ser consequência da experiência.

### CTA

`Conheça a estrutura da Consultora Lardan`

→ `/seja-lardan`

### CTA SECUNDÁRIO

`Ainda está começando? Leia o guia completo`

→ `/como-comecar-a-vender-semijoias`

==================================================
36. FAQ PÁGINA 4
================

Responder:

1. Como começar a vender semijoias pelo WhatsApp?
2. O que mandar para amigas?
3. Como vender sem parecer inconveniente?
4. Como usar Status para vender?
5. WhatsApp Business é obrigatório?
6. Como criar catálogo?
7. Como tirar boas fotos?
8. Quantas opções devo mandar?
9. Como responder quando a cliente diz que está caro?
10. Como responder “vou pensar”?
11. Como cobrar uma cliente atrasada?
12. Como evitar vender fiado?
13. Como fazer pós-venda?
14. Como conseguir indicações?
15. Como organizar clientes?
16. Preciso de CRM?
17. Como lembrar aniversários?
18. Como descobrir o estilo da cliente?
19. Como vender para pessoas que não conheço?
20. Como a Lardan ajuda a consultora a organizar clientes?

==================================================
37. RESPOSTAS PARA IA
=====================

Todas as quatro páginas precisam ter blocos de resposta direta.

Pergunta:

“Vale a pena vender semijoias?”

Primeiro parágrafo deve responder.

Depois aprofundar.

Pergunta:

“Como funciona uma maleta consignada?”

Primeiro parágrafo responde.

Depois detalhes.

Pergunta:

“Sou mãe e preciso aumentar minha renda. O que posso fazer?”

Primeiro parágrafo responde.

Não começar com:

“Nos dias atuais...”

Não escrever introdução vazia.

==================================================
38. ÍNDICE COM ÂNCORAS
======================

Cada página possui um índice.

Links HTML reais:

`href="#como-comecar"`

etc.

Não usar botão Javascript quando um anchor resolve.

No desktop pode ficar em coluna/sticky de forma elegante.

No mobile deve recolher ou se apresentar de forma compacta e acessível.

==================================================
39. FONTES VISÍVEIS
===================

No final:

## Fontes e referências

Mostrar:

nome da instituição;
título;
ano;
link.

External link:

abrir adequadamente;
usar `rel="noopener noreferrer"` quando nova aba.

Não esconder fonte.

Não criar fonte inexistente.

==================================================
40. AUTOR NO FINAL
==================

Depois das referências:

### Sobre o autor

Daniel de Freitas Maciel

Fundador e CEO da Lardan

“Engenheiro civil de formação, Daniel atua há 15 anos com redes de venda consignada e fundou a Lardan ao lado de Larissa Persinato Dias Maciel.”

Link:

Conheça a história da Lardan

→ `/a-lardan`

Foto:

usar ativo oficial existente quando apropriado.

Não gerar pessoa nova.

==================================================
41. INTERLINKING
================

PÁGINA 1:

links para:
Página 2
Página 3
Seja Lardan
A Lardan

PÁGINA 2:

links para:
Página 1
Página 3
Página 4
Seja Lardan
Semijoias

PÁGINA 3:

links para:
Página 2
Página 4
Seja Lardan
A Lardan
catálogo

PÁGINA 4:

links para:
Página 1
Página 2
Página 3
Seja Lardan

Não colocar links artificiais em toda palavra “semijoia”.

Contexto.

==================================================
42. /SEJA-LARDAN — LINKS PARA OS GUIAS
======================================

Adicionar próximo ao conteúdo educacional, sem prejudicar conversão:

### Quer entender melhor antes de se candidatar?

Cards editoriais:

Renda extra com vendas
Como começar a vender semijoias
Como funciona o consignado
Como vender semijoias pelo WhatsApp

Isso transmite:

“A Lardan não quer apenas seu cadastro. Quer que você entenda o modelo.”

==================================================
43. FOOTER
==========

No Footer atual, criar uma seção/coluna elegante:

GUIAS

* Renda extra com vendas
* Como começar a vender semijoias
* Semijoias consignadas
* Vendas pelo WhatsApp

Não aumentar o Footer a ponto de ficar caótico.

==================================================
44. HOME
========

Não transformar a Home em blog.

Pode adicionar apenas um bloco editorial discreto, se ficar visualmente excelente:

### Conteúdo para quem quer construir

2 ou 4 chamadas.

Se prejudicar a Home premium, NÃO adicionar.

O interlinking do Footer + Seja Lardan já pode ser suficiente.

==================================================
45. HTML
========

Conteúdo precisa existir no HTML servidor.

Usar:

`<article>`
`<header>`
`<nav aria-label="...">`
`<section>`
`<h1>`
`<h2>`
`<h3>`
`<blockquote>`
`<figure>`
`<figcaption>`
`<table>`
`<footer>` do artigo quando adequado.

Somente UM H1.

Não montar artigo com 300 divs.

==================================================
46. SSR
=======

Stack atual é TanStack Start.

Preservar SSR.

Testar HTML retornado SEM Javascript.

Quero encontrar no source:

title;
description;
canonical;
H1;
autor;
parágrafo inicial;
H2;
fonte;
links;
JSON-LD.

==================================================
47. META
========

Cada página possui:

title exclusivo;
description exclusiva;
canonical;
og:title;
og:description;
og:type = article;
og:url;
og:image;
twitter card.

Se possível criar imagem social editorial específica sem gerar mídia falsa.

Pode reutilizar imagem Lardan adequada, desde que semanticamente coerente.

==================================================
48. OG
======

Não usar foto aleatória.

Página 1:
família/consultora/vida real.

Página 2:
consultora + semijoias.

Página 3:
produto/maleta somente se houver ativo real.

Página 4:
consultora/celular/ferramentas.

Não criar representação de maleta se não houver imagem real.

==================================================
49. SITEMAP
===========

Adicionar as quatro URLs ao sitemap.

Sugestão:

priority 0.8
changefreq monthly

ou configuração coerente.

Não fingir atualização semanal se não houver atualização.

==================================================
50. ROBOTS
==========

As quatro páginas:

index, follow.

Não bloquear.

Não alterar bloqueios privados atuais.

Atualizar Sitemap URL quando domínio oficial mudar.

==================================================
51. LLMS.TXT
============

Criar seção:

## Guias e conteúdos

* Renda extra com vendas
* Como começar a vender semijoias
* Semijoias consignadas para revenda
* Como vender semijoias pelo WhatsApp

Explicar cada URL em uma linha.

Criar seção:

## Autoria editorial

“Os guias sobre venda consignada, consultoria e desenvolvimento comercial são assinados por Daniel de Freitas Maciel, fundador e CEO da Lardan, com 15 anos de atuação em redes de venda consignada.”

Não exagerar autoridade.

==================================================
52. LINKS DESCRIBEDBY
=====================

Se tecnicamente apropriado e consistente com o projeto, adicionar no documento público:

`<link rel="describedby" href="${SITE_URL}/llms.txt">`

Não hardcode domínio.

==================================================
53. IMAGENS
===========

Reutilizar ativos existentes quando adequados:

* Lardan família;
* Daniel/Larissa;
* consultora;
* produto;
* ferramentas.

NÃO gerar imagem falsa de fundador.

NÃO gerar depoimento.

NÃO inventar cliente.

Alt deve descrever a imagem.

Decorativa:
alt=""

==================================================
54. PERFORMANCE
===============

Artigos longos não podem virar páginas pesadas.

* lazy load abaixo da dobra;
* imagens responsivas;
* WebP/AVIF existentes;
* width/height;
* evitar CLS;
* hero otimizado;
* não importar biblioteca nova sem necessidade;
* evitar animações pesadas;
* conteúdo acessível antes de JS.

==================================================
55. MOBILE
==========

Essas páginas precisam ser excelentes em:

360
375
390
412
430

Desktop:

768
1024
1280
1440
1920.

Tabelas precisam funcionar no celular.

Se necessário:

overflow controlado com indicação visual
ou transformação acessível.

Não cortar conteúdo.

==================================================
56. ACESSIBILIDADE
==================

* skip link atual preservado;
* headings coerentes;
* foco;
* contraste;
* links identificáveis;
* botões com label;
* copiar mensagem acessível;
* tabelas com `<thead>` e headers;
* conteúdo não depender de hover;
* `prefers-reduced-motion`.

==================================================
57. CTA TRACKING
================

Cada CTA editorial deve registrar no CLIENTE somente contexto de navegação não sensível.

Exemplos:

article_slug
cta_id
destination
timestamp

Não coletar fingerprint.

Não sobrescrever aquisição externa.

IDs sugeridos:

p1_to_p2
p1_to_seja
p2_to_p3
p2_to_seja
p3_to_seja
p4_to_seja

Quando candidatura ocorrer:

essa informação deve chegar no last_touch existente.

==================================================
58. ANALYTICS
=============

Se GA4/GTM já estiver configurado:

preservar.

Não duplicar script.

Eventos úteis:

editorial_view
editorial_cta_click
editorial_copy_script
seja_lardan_from_editorial

Se GA não estiver instalado:

NÃO introduzir secretamente uma plataforma externa.

CRM attribution continua funcionando independentemente.

==================================================
59. CANDIDATURA
===============

Fluxo final esperado:

Google
→ artigo
→ outro artigo
→ Seja Lardan
→ candidatura

CRM precisa conseguir mostrar:

first_referrer;
first_landing_page;
origem normalizada;
first_at;
UTMs;
último conteúdo;
CTA anterior;
landing da candidatura;
IP/user-agent conforme permissão já existente.

Não alterar lógica de deduplicação.

==================================================
60. CONSENTIMENTO / LGPD
========================

Não criar tracking invasivo.

Não criar fingerprint.

Não tentar descobrir identidade antes do formulário.

Não transmitir dados pessoais para novas ferramentas externas.

Preservar consentimento e aviso de privacidade existentes.

==================================================
61. CANONICAL
=============

Cada artigo:

canonical para si mesmo.

Zero parâmetros em canonical.

Exemplo:

`/renda-extra-com-vendas?utm_source=google`

canonical:

`/renda-extra-com-vendas`

==================================================
62. BREADCRUMBS
===============

Visual e JSON-LD.

Exemplo:

Lardan

>

Guias

>

Renda Extra com Vendas

Não precisa criar `/guias` se não existir.

Se “Guias” não tiver URL, não inventar item clicável incompatível com BreadcrumbList.

Pode usar:

Lardan

>

Renda Extra com Vendas

até existir hub.

==================================================
63. FAQ
=======

Perguntas precisam estar visíveis.

O JSON-LD deve usar EXATAMENTE a mesma fonte de dados do FAQ renderizado.

Nada de FAQ escondido apenas no schema.

==================================================
64. NÃO CANIBALIZAR /SEJA-LARDAN
================================

`/seja-lardan`

continua responsável por:

ser consultora;
candidatura;
benefícios Lardan;
processo;
formulário.

Os artigos informam.

Não duplicar o mesmo H1/intenção.

==================================================
65. NÃO CANIBALIZAR PRODUTOS
============================

Artigos não devem tentar ranquear como página transacional de:

brincos;
anéis;
colares;
pulseiras.

Quando mencionar categoria:

link para catálogo.

==================================================
66. ENTIDADES SEMÂNTICAS
========================

Trabalhar naturalmente:

renda extra;
renda complementar;
trabalho por conta própria;
consultora;
revendedora;
venda;
cliente;
semijoias;
consignação;
maleta;
garantia;
WhatsApp;
Instagram;
CRM;
pós-venda;
recebimento;
comissão;
estoque;
atendimento;
vitrine;
relacionamento;
gestão financeira;
família;
rotina;
empreendedorismo.

Não keyword stuffing.

==================================================
67. NÃO PUBLICAR KEYWORD LIST
=============================

A lista acima é para compreensão semântica.

Não criar rodapé:

“palavras relacionadas: renda extra, semijoia...”

Isso é proibido.

==================================================
68. NÚMEROS DA LARDAN
=====================

Podem ser utilizados apenas quando já oficiais no conteúdo institucional.

Exemplo existente:

mais de 2.500 consultoras.

mais de R$ 2,8 milhões em comissões acumuladas conforme conteúdo institucional fornecido pela marca.

NUNCA chamar esse valor de:

faturamento.

NUNCA converter em:

renda média.

NUNCA dividir por consultora e produzir ganho estimado.

Faturamento da empresa continua NÃO PUBLICÁVEL.

==================================================
69. GARANTIA
============

Pode afirmar:

“2 anos de garantia”

porque é informação oficial.

Sempre:

“conforme as condições oficiais da Lardan.”

Não inventar cobertura.

==================================================
70. ARTIGO NÃO É PROPAGANDA DISFARÇADA
======================================

Sempre que houver comparação:

ser justa.

Sempre que houver risco:

explicar.

Sempre que houver condição desconhecida:

não inventar.

Esse nível de transparência é parte da estratégia SEO.

==================================================
71. FONTE DE CONTEÚDO
=====================

Criar estrutura organizada.

Sugestão:

`src/lib/editorial/...`

ou estrutura semelhante.

Não colocar 5.000 linhas diretamente na rota se o projeto puder separar:

metadata;
FAQ;
fontes;
seções;
autor.

Mas não abstrair tanto a ponto de prejudicar SSR ou manutenção.

==================================================
72. COMPONENTES REUTILIZÁVEIS
=============================

Podem existir:

EditorialHero
EditorialAuthor
EditorialToc
EditorialQuestion
EditorialSource
EditorialCTA
EditorialFAQ
RelatedGuides

Usar somente se melhorarem consistência.

Não transformar tudo em componente microscópico.

==================================================
73. FONTES NO ARTICLE SCHEMA
============================

Não inventar schema de citação complexo.

Links HTML visíveis são prioridade.

Se utilizar `citation` no Article e estiver tecnicamente correto, apontar somente para fontes reais utilizadas.

==================================================
74. TESTE DE CONTEÚDO
=====================

Buscar no HTML:

Página 1:
“Sou mãe e preciso aumentar minha renda”

Página 2:
“Vale a pena vender semijoias?”

Página 3:
“O que são semijoias consignadas?”

Página 4:
“Como começar a vender semijoias pelo WhatsApp?”

Se esses conteúdos só aparecerem após JS:

FALHOU.

==================================================
75. TESTE DO AUTOR
==================

Cada página:

Daniel visível.

Article:
Daniel.

Person:
mesmo @id.

Nenhuma página assinada genericamente por:

“Redação”
“Equipe”
“Admin”
“Lardan Blog”

==================================================
76. TESTE DO TRACKING
=====================

CENÁRIO A

Abrir:

`/renda-extra-com-vendas?utm_source=google&utm_medium=organic_test`

Navegar:

→ Página 2
→ Seja Lardan
→ enviar candidatura sintética.

PROVAR:

first_landing_page = página 1

UTM preservada

last_content = página 2

candidatura entrou CRM.

CENÁRIO B

Abrir diretamente:

Página 3 sem UTM.

→ Seja Lardan
→ formulário.

PROVAR:

origem não inventada;
first landing correta.

CENÁRIO C

Abrir com:

utm_source=chatgpt

PROVAR:

ChatGPT somente porque UTM forneceu evidência.

==================================================
77. TESTE DE NÃO SOBRESCRITA
============================

Usuária entra:

Google
→ Página 1.

Depois navega internamente.

NÃO transformar source em:

site;
internal;
direct.

First touch continua Google.

==================================================
78. TESTE DE SEO
================

Para cada uma das quatro URLs:

HTTP 200

1 H1

title

description

canonical

og:type article

og:url

og:image

Article JSON-LD

Person Daniel

BreadcrumbList

FAQPage quando existente

HTML inicial

links internos

autor

fontes

data

mobile.

==================================================
79. TESTE DE SITE
=================

Também retestar:

/
`/a-lardan`
`/seja-lardan`
`/semijoias`
`/contato`
`/sitemap.xml`
`/robots.txt`
`/llms.txt`

404 real.

Não quebrar existente.

==================================================
80. TESTE DO LANG
=================

HTML:

`<html lang="pt-BR">`

PROVAR.

==================================================
81. BUILD
=========

Rodar:

build
testes existentes relevantes

Não deixar TypeScript quebrado.

Não ignorar erro.

==================================================
82. SEGURANÇA
=============

As novas páginas são públicas.

NÃO devem importar:

service role;
segredos;
RPC administrativa;
dados de candidatas;
consultoras;
clientes.

Tracking envia somente dados permitidos no fluxo existente.

==================================================
83. PERFORMANCE
===============

Não quero quatro páginas excelentes em SEO e péssimas em Core Web Vitals.

Verificar:

LCP
CLS
INP provável
peso de imagens
scripts
fontes
render.

Não precisa prometer nota Lighthouse inexistente.

Medir quando possível.

==================================================
84. RESULTADO EDITORIAL
=======================

Quero que uma mulher possa entrar sem conhecer a Lardan.

Ela pergunta:

“Preciso aumentar minha renda.”

Nós respondemos.

Depois:

“O que posso vender?”

Nós respondemos.

“Semijoias valem a pena?”

Nós respondemos.

“Preciso comprar estoque?”

Nós respondemos.

“Como funciona consignado?”

Nós respondemos.

“Como vou vender?”

Nós respondemos.

“Como uso WhatsApp?”

Nós respondemos.

“Como vou organizar minhas clientes?”

Mostramos o CRM.

“Como vou controlar o negócio?”

Mostramos o Lardan OS.

“Quem é essa empresa?”

Mostramos Daniel, Larissa e a história.

“As peças têm garantia?”

2 anos.

“Quero saber mais.”

Seja Lardan.

“Quero entrar.”

Candidatura.

CRM.

==================================================
85. FILOSOFIA DO CONTEÚDO
=========================

Não queremos aparecer no Google porque repetimos “renda extra”.

Queremos aparecer porque produzimos uma das melhores respostas disponíveis.

Não queremos aparecer no ChatGPT porque escrevemos “ChatGPT” em uma página.

Queremos ser compreendidos porque:

a entidade é clara;
a autoria é real;
o conteúdo é profundo;
as fontes existem;
as respostas são diretas;
o HTML existe;
os fatos são consistentes;
os links são coerentes;
a marca tem história;
o conteúdo ajuda de verdade.

==================================================
86. RELATÓRIO FINAL OBRIGATÓRIO
===============================

Depois de implementar, responda em blocos:

1. AUDITORIA ANTES DA ALTERAÇÃO

2. CORREÇÕES TÉCNICAS GERAIS

* lang
* SITE_URL
* tracking

3. PÁGINA 1

* URL
* title
* H1
* Article
* FAQ
* links
* fonte

4. PÁGINA 2

5. PÁGINA 3

6. PÁGINA 4

7. AUTORIA DANIEL

8. SEO SEMÂNTICO

9. SEO TÉCNICO

10. JSON-LD

11. TRACKING FIRST TOUCH

12. TRACKING DA JORNADA EDITORIAL

13. INTEGRAÇÃO COM CRM

14. SITEMAP

15. ROBOTS

16. LLMS.TXT

17. INTERLINKING

18. MOBILE

19. PERFORMANCE

20. ACESSIBILIDADE

21. TESTES

22. PROVAS DE HTML SERVER-SIDE

23. PROVAS DO CRM

24. PROVAS DO FIRST TOUCH

25. REGRESSÕES VERIFICADAS

26. PENDÊNCIAS REAIS

==================================================
87. NÃO ME RESPONDA COM PLANO
=============================

Não diga:

“Eu sugiro...”
“Podemos fazer...”
“Minha recomendação...”

IMPLEMENTE.

Você possui o projeto.

Audite.

Altere.

Teste.

Comprove.

==================================================
88. ÚLTIMA REGRA
================

Não destrua nada do que já está funcionando.

Estas páginas devem parecer ter nascido junto com a Lardan.

Não são quatro posts.

São quatro portas de entrada para uma mesma história:

UMA PESSOA TEM UMA NECESSIDADE.

ELA PROCURA UMA RESPOSTA.

A LARDAN ENTREGA INFORMAÇÃO.

A INFORMAÇÃO GERA CONFIANÇA.

A CONFIANÇA APRESENTA UMA POSSIBILIDADE.

A POSSIBILIDADE APRESENTA UMA ESTRUTURA.

A ESTRUTURA LEVA À CANDIDATURA.

E A CANDIDATURA CHEGA ORGANIZADA AO LARDAN OS.

Esse é o objetivo.

FAÇA COM PADRÃO DE PRODUÇÃO.
TESTE.
PROVE.
