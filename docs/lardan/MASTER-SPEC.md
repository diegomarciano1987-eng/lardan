# LARDAN — PROMPT MESTRE DE IMPLEMENTAÇÃO PARA O LOVABLE

## Como usar este arquivo

Anexe este arquivo ao projeto Lovable, junto dos três PDFs do escopo, da logo original e das seis imagens finais sem textos. Envie o comando de partida abaixo. O arquivo é a especificação completa; o comando limita a execução a lotes verificáveis para reduzir interrupções e perda de contexto.

COMANDO DE PARTIDA:

Leia integralmente o arquivo LARDAN-PROMPT-MESTRE-LOVABLE.md e os três PDFs anexados. Preserve esta especificação em docs/lardan/ dentro do projeto antes de implementar. Minha prioridade de hoje é concluir o site público e seu admin real, com persistência, segurança e testes. O restante do Lardan Cloud deve ficar mapeado em requisitos, rotas, ações, entidades, dependências e critérios de aceite, mas desativado e sem simular operação real. Execute agora o lote 0 e depois o lote 1; se houver capacidade, prossiga na ordem indicada, com checkpoint após cada lote. Não tente construir todo o ERP em uma resposta. Se parar, informe exatamente onde parou, o que foi salvo, o que foi testado, o bloqueio e o comando exato de continuação. Não declare que terminou sem evidências. Siga todas as regras do arquivo, não apenas este resumo.

---

# INÍCIO DA ESPECIFICAÇÃO PARA O LOVABLE

## 1. Missão e limite desta execução

Atue como arquiteto de software, diretor de produto, designer de interfaces premium e engenheiro responsável por qualidade. Construa o ecossistema Lardan Cloud, também referido nos documentos como Lardan OS. A marca pública é LARDAN. A prioridade comercial central é a consultora; estoque e financeiro dão sustentação; o PDV amplia a arquitetura para lojas físicas futuras.

Hoje quero um SITE COMPLETO EM MODO INSTITUCIONAL/CATÁLOGO/CAPTAÇÃO, administrável e utilizável, preparado para evoluir para e-commerce transacional. Não quero checkout falso, cobrança não homologada, estoque fictício nem dezenas de telas operacionais superficiais apresentadas como ERP pronto.

Divida o escopo em quatro estados:

- AGORA: site, catálogo editorial, categorias, coleções, busca e filtros, conteúdo, captação, contato, administração do site, autenticação administrativa, autorização, persistência, SEO técnico e testes.
- FUNDAÇÃO: contratos de dados, identificação dos canais, reservas de rotas, registro de funcionalidades, design system interno, catálogo privado de módulos e documentação de integração.
- ETAPAS CONTRATADAS POSTERIORES: operação de estoque, financeiro, consultoras, representantes, maletas, vendas, cobrança, qualidade, Academy, ranking e BI conforme cronograma.
- FUTURO/CONDICIONAL: PDV operacional, IA preditiva, Lardan Club e capacidades dependentes de fornecedor, credencial, homologação ou decisão da Lardan.

Não altere o contrato nem o cronograma porque a prioridade de hoje é o site. Não ative automaticamente módulos futuros ao terminar o site. Termine a entrega atual, reporte e aguarde autorização para a próxima etapa.

## 2. Fontes, precedência e cautelas de escopo

Fontes fornecidas:

- C: CONTRATO FINAL LARDAN E NEXT SMALLDATA (1).pdf — cláusulas 1 a 21, Anexo A resumido com 17 módulos e Anexo II de cronograma incluídos no mesmo arquivo.
- A: ANEXO A Lardan Cloud.pdf — título interno “ANEXO A - 2 LARDAN Cloud”, documento mestre, seções 1 a 23.
- P: ANEXO LARDAN PDV.pdf — título interno “ANEXO A - 1- NOVO MÓDULO FUTURO”, itens 1 a 47.
- V: decisões visuais e prioridade de execução deste prompt, dadas por Diego.

Registre a origem de cada requisito usando documento e seção. A cláusula 1.3 registra Contrato > Proposta (Anexo A) > Anexos > Comunicações Formais. Os títulos dos anexos se sobrepõem: mantenha seus nomes originais e não invente equivalência documental ou aditivo. Divergências relevantes precisam constar em docs/lardan/DECISOES-PENDENTES.md; não resolver silenciosamente.

O contrato menciona outros anexos de escopo, suporte/SLA, comunicação, segurança e tabela de valores. Não assuma que foram fornecidos integralmente como documentos separados. Não invente SLA, política de retenção ou obrigação não descrita nos arquivos disponíveis. A leitura dos PDFs não é validação criptográfica de assinatura.

Cronograma de referência, extraído de C/Anexo II:

1. Dias 1–30: site + fundação + primeira versão funcional de estoque/importações + financeiro amplo e funcional.
2. Dias 31–60: maletas, consultoras, representantes, CRM, vendas, pagamentos, integração inicial Asaas, contratos, recrutamento, onboarding, treinamento e ranking inicial.
3. Dias 61–90: cobrança, comissões, ranking, níveis, premiações, campanhas, qualidade, garantias, Academy, BI, governança e consolidação.

O início depende das condições da cláusula 6.1; não inferir cumprimento apenas pela data do PDF. O contrato prevê homologação por entrega e estabilização; mantenha registro de evidências e validações, sem automatizar aceite jurídico ou notificação contratual.

Separe “obrigação”, “exemplo parametrizável”, “possibilidade condicionada” e “ideia futura”. Os números discutidos nos anexos não são automaticamente parâmetros ativos. Não transportar multas, juros e valores do contrato Small Data × Lardan para o financeiro de consultoras ou clientes: são relações diferentes. Não publicar PDFs, valores comerciais privados, CPF dos representantes ou documentos pessoais no site.

## 3. Protocolo de continuidade: obrigatório antes da interface

Crie e mantenha no repositório:

- docs/lardan/MASTER-SPEC.md: cópia integral desta especificação.
- docs/lardan/FONTES-E-ESCOPO.md: documentos, seções, classificação de cada requisito e ambiguidades.
- docs/lardan/MATRIZ-RASTREABILIDADE.md: cada requisito até seu teste e evidência.
- docs/lardan/INVENTARIO-ACOES.md: botões, links, filtros, formulários e comandos.
- docs/lardan/ROTAS-E-PERMISSOES.md: rotas públicas/privadas, perfis, ações e escopos.
- docs/lardan/MODELO-DE-DADOS.md: entidades, relações, estados, invariantes e futuro.
- docs/lardan/INTEGRACOES.md: fornecedores, capacidades pretendidas e dependências.
- docs/lardan/DECISOES-PENDENTES.md: decisões que não podem ser inventadas.
- docs/lardan/TESTES-E-EVIDENCIAS.md: casos executados, resultados e limitações.
- docs/lardan/PROGRESSO.md: ponto de retomada atualizado ao concluir cada subtarefa relevante.

Em PROGRESSO.md, registrar: lote, requisito, ação, último trabalho concluído, arquivos alterados, migrações aplicadas, testes executados, falhas, próxima ação segura e bloqueios. Escrever checkpoints durante o trabalho, não apenas no final: uma interrupção abrupta pode impedir a mensagem de encerramento.

Se interromper por limite, erro, crédito, contexto, credencial ou dependência, responder:

“PAUSEI NO LOTE [n], requisito [ID], ação [ID]. Concluído e salvo: [...]. Testado: [...]. Não concluído: [...]. Bloqueio: [...]. Próxima ação segura: [...]. Para continuar, envie: [...].”

Nunca diga apenas “continuo depois”. Não recomece do zero após uma pausa. Leia PROGRESSO.md, confira os arquivos e retome do primeiro requisito não validado. Não substitua documentação detalhada por resumo destrutivo.

Comando padrão de retomada:

“Continue o Lardan a partir de docs/lardan/PROGRESSO.md. Confira MASTER-SPEC.md e MATRIZ-RASTREABILIDADE.md. Preserve tudo que já funciona. Retome o primeiro requisito não validado do lote registrado, execute um lote verificável, atualize os testes e o checkpoint e informe o próximo passo. Não expanda o escopo nem ative módulos futuros.”

## 4. Direção de arte aprovada: o site

Não reinterpretar a marca como loja genérica. A referência aprovada é a PRIMEIRA opção com onda transparente de vidro, fundo claro, luz marfim e reflexos rosé. NÃO usar o portal circular como hero principal: aquela sugestão anterior não foi a escolha final de Diego.

Use as seis imagens finais limpas, na ordem e pelo conteúdo:

| Asset sugerido | Conteúdo | Papel |
| --- | --- | --- |
| lardan-hero-vidro | Apenas onda de vidro; sem joia, logo ou texto | Abertura |
| lardan-categoria-aneis | Anel no vale da onda transparente | Categoria anéis |
| lardan-categoria-colares | Colar sobre pétalas de vidro | Categoria colares |
| lardan-categoria-pulseiras | Pulseira sobre arco de vidro | Categoria pulseiras |
| lardan-categoria-brincos | Brinco sobre pedestal circular | Categoria brincos |
| lardan-editorial-mulher | Mulher com colar, brincos e pulseira visível | Editorial/relacionamento |

Os arquivos foram gerados como imagens estáticas. NÃO existe vídeo entregue. Não finja que as imagens contêm animação. A dissolução será implementada separadamente. Não usar caminhos locais deste chat como URL pública: importar os anexos para os assets do projeto e registrar o mapeamento real.

Essas peças são conceituais, não fotografias verificadas do catálogo da Lardan. Servem como direção editorial; não inventar SKU, composição, estoque, preço ou disponibilidade para elas. Não vinculá-las a produto vendável sem confirmação. Registrar aprovação de uso editorial antes da publicação pública.

Logo: usar arquivo original. Separar diamante e wordmark por recorte/máscara não destrutiva ou vetor oficial fornecido, preservando geometria, espessura, proporção e gradiente. Não redigitar “LARDAN” com fonte parecida. Não redesenhar o símbolo. Manter os originais.

### 4.1 Hero e narrativa de scroll

Estado inicial:

- Fundo claro com vidro original.
- Somente diamante central, sem nome LARDAN, sem joia, sem título, sem subtítulo, sem CTA de venda.
- Menu sutil, flutuante e central no topo, cinco itens exatos: “A Lardan”, “Semijoias”, “Coleção”, “Seja Lardan”, “Contato”.
- Linha rosé muito fina abaixo do item ativo. Usar texto legível, transparência moderada e contraste suficiente; sem sombras pesadas.
- Menu real em HTML; logo real em imagem/vetor; nada gravado no fundo.

Sequência ao ROLAR verticalmente (não depender de girar o celular):

1. Diamante permanece nítido na entrada.
2. Com o avanço do scroll, dissolve-se em névoa rosé muito sutil.
3. Diamante desaparece completamente; aparece apenas o wordmark LARDAN, sem símbolo, em um breve estado próprio.
4. Prosseguindo o scroll, o wordmark assume a composição editorial; entram título, subtítulo, CTA e primeira categoria com joia no vidro.
5. O movimento termina com conteúdo estável e navegável.

Texto inicial de proposta, editável pelo admin:

- Título: “Única. Como cada história.”
- Subtítulo: “Semijoias para acompanhar os seus momentos.”
- CTA: “Conhecer semijoias”, destino /semijoias.

Não aprisionar o usuário em animação longa. Não bloquear roda do mouse, teclado, barra de rolagem ou toque. Sem scroll hijacking. Ir diretamente a uma categoria pelo menu deve funcionar mesmo sem assistir à abertura. Voltar na rolagem deve ser estável, sem piscar ou duplicar logos.

A transição deve parecer um único ambiente: usar sobreposição controlada de camadas, fundo-base comum e crossfade suave; imagens independentes não garantem emenda geométrica exata. Corrigir o encaixe visual nos breakpoints, em vez de apenas empilhar PNGs com cortes aparentes.

A fumaça deve ser leve. Não carregar biblioteca 3D gigantesca só para esse efeito. Pode usar textura de névoa, máscaras e dissolução progressiva com fallback; confirmar compatibilidade real da técnica escolhida. Caso vídeo externo seja necessário para fidelidade cinematográfica, registrar dependência, manter fallback elegante e não declarar vídeo produzido. A versão estática precisa funcionar integralmente.

### 4.2 Continuação da home

- Quatro cenas de categoria: anéis, colares, pulseiras e brincos. Cada cena com uma joia protagonista e CTA real para sua categoria.
- Todas com espaço, hierarquia e respiro; sem mosaico apertado de dezenas de peças na home.
- Editorial com a mulher e joias: usar como ambientação de marca, não depoimento ou consultora real.
- Coleção em destaque selecionada pelo CMS; produtos reais publicados, sem preços inventados.
- Qualidade/garantia: apresentar garantia comercial de 2 anos conforme regras aprovadas, sem inventar cobertura irrestrita.
- Seja Lardan: convite elegante para candidatura, sem promessa garantida de renda.
- Contato e rodapé: informações empresariais confirmadas, atendimento, links institucionais e legais, acesso discreto “Acessar Lardan”.

### 4.3 Mobile, acessibilidade e performance

Mobile é critério de aceite, não adaptação de última hora. Em desktop manter os cinco links centrais; em telas estreitas usar cápsula compacta com menu acessível que contém os mesmos cinco destinos, sem texto espremido ou overflow.

Definir foco das imagens por breakpoint. Se a joia ou o pulso não couberem, separar imagem e texto em blocos; não cortar o protagonista para preservar layout desktop. Usar alturas fluidas, áreas seguras e contraste suficiente. Testar 360, 390, 768, 1280 e 1440 px.

Teclado completo, foco visível, nomes acessíveis, labels, erros associados aos campos, skip link e ordem de leitura. Oferecer conteúdo essencial sem animação, sem JS quando viável na arquitetura escolhida e com prefers-reduced-motion. Não esconder o H1 indexável por tempo indefinido; manter heading semântico no bloco editorial e identificação acessível da marca na abertura.

Gerar derivados otimizados mantendo originais; AVIF/WebP quando adequado, srcset, dimensões explícitas. Priorizar apenas a imagem LCP; lazy loading abaixo da dobra. Evitar carregar as seis imagens grandes imediatamente. Suspender efeitos fora da tela. Metas técnicas: LCP <= 2,5 s, INP <= 200 ms, CLS <= 0,1 em condições documentadas; distinguir teste de laboratório de dados reais. Não prometer nota 100 sem medição.

## 5. Arquitetura de páginas e navegação pública

Resolver conflito de URL desde já: /loja fica reservado ao PDV privado futuro. A loja/catálogo público usa /semijoias. Reservar /admin, /sistema, /app, /representante, /loja e /acesso antes de aceitar slugs de consultoras.

As aproximadamente 15 páginas principais previstas em C/Anexo A/1 e A/4 serão materializadas pela seguinte proposta de arquitetura. Slugs são decisões técnicas deste prompt, não transcrição literal do contrato.

| ID | Rota | Entrega e ações |
| --- | --- | --- |
| WEB-01 | / | Hero, scroll, categorias, editorial, coleção, recrutamento e rodapé |
| WEB-02 | /semijoias | Catálogo, busca por nome/SKU, filtros, ordenação, paginação e limpar filtros |
| WEB-03 | /novidades | Produtos reais marcados como lançamento, sem data falsa |
| WEB-04 | /mais-vendidos | Base em dados válidos; sem dados, estado vazio honesto, sem ranking inventado |
| WEB-05 | /colecoes | Listagem editorial e abrir /colecoes/:slug |
| WEB-06 | /semijoias/brincos | Categoria brincos e produtos filtrados |
| WEB-07 | /semijoias/colares | Categoria colares e produtos filtrados |
| WEB-08 | /semijoias/pulseiras | Categoria pulseiras e produtos filtrados |
| WEB-09 | /semijoias/aneis | Categoria anéis e produtos filtrados |
| WEB-10 | /presentes | Curadoria real por tags, sem produto fictício |
| WEB-11 | /a-lardan | História, marca, estrutura e diferenciais aprovados |
| WEB-12 | /qualidade-e-garantia | Materiais e cuidados confirmados, garantia e contato |
| WEB-13 | /encontre-uma-consultora | Buscar cidade/UF e somente contatos públicos autorizados; alternativa de solicitar atendimento |
| WEB-14 | /seja-lardan | Apresentação e formulário de candidatura persistido |
| WEB-15 | /conteudos | Hub de conteúdo e /conteudos/:slug |

Rotas auxiliares necessárias: /contato, /produto/:slug, /privacidade, /termos, /acesso, /recuperar-acesso e página 404 real. Carrinho, checkout, conta do cliente e pedidos ficam registrados para etapa transacional, sem links públicos quebrados. Não confundir essas rotas auxiliares com páginas faltantes.

Menu: A Lardan -> /a-lardan; Semijoias -> /semijoias; Coleção -> /colecoes; Seja Lardan -> /seja-lardan; Contato -> /contato. Não usar href="#" para fingir navegação.

### 5.1 Quinze páginas de captação

Criar estrutura CMS e conteúdo inicial original para as quinze pautas abaixo. Não copiar o mesmo texto trocando título. Para cada pauta registrar intenção, conteúdo específico, FAQ própria, relação com a Lardan e CTA de candidatura. Sem promessa de renda, aprovação ou retorno garantido. Aprovação editorial pendente não é autorização para publicar texto inventado.

| ID | Rota sob /seja-lardan/ | Foco próprio |
| --- | --- | --- |
| CAP-01 | como-vender-semijoias | Primeiros passos e atendimento |
| CAP-02 | como-ganhar-dinheiro-com-semijoias | Custos, margem e organização; sem garantias |
| CAP-03 | renda-extra-com-semijoias | Planejamento de atividade complementar |
| CAP-04 | trabalhe-com-semijoias | Rotina e responsabilidades |
| CAP-05 | seja-revendedora-de-semijoias | Como candidatar-se e etapas de análise |
| CAP-06 | como-comecar-a-vender-joias | Guia introdutório, distinguindo semijoias |
| CAP-07 | venda-semijoias-em-casa | Organização de atendimentos em casa |
| CAP-08 | trabalhe-no-seu-horario | Gestão de agenda, sem prometer ausência de obrigações |
| CAP-09 | renda-pelo-celular | Uso de ferramentas digitais; marcar recursos futuros |
| CAP-10 | consultora-lardan | Papel da consultora e relacionamento com a marca |
| CAP-11 | vendedora-de-semijoias | Competências e atendimento consultivo |
| CAP-12 | oportunidade-de-renda | Planejamento responsável e perfil da atividade |
| CAP-13 | venda-semijoias-pelo-whatsapp | Catálogo e abordagem respeitosa |
| CAP-14 | como-aumentar-sua-renda | Recorrência e organização comercial |
| CAP-15 | quero-vender-lardan | Landing direta de candidatura e próximos passos |

As quinze rotas devem ser navegáveis em homologação, com renderização e formulários funcionais. Páginas sem fatos essenciais aprovados permanecem rascunho e fora do sitemap público. Informar quantidade de páginas implementadas, publicadas e bloqueadas separadamente. Não declarar “site público completo” se houver pendências essenciais de publicação.

### 5.2 Catálogo e detalhes de produto

Fonte única de produtos para catálogo atual e operação futura. Campos públicos: nome, slug, categoria, coleção, descrição, material/banho verificados, variações, medidas, peso se disponível, imagens com alt, cuidados, garantia, preço quando autorizado e disponibilidade apenas se confiável.

Custos, margens, fornecedores internos, documentos e regras de comissão nunca devem sair na consulta pública. Criar projeção/API pública explicitamente limitada; ocultar colunas na tela não basta.

Busca e filtros precisam retornar dados reais: termo, categoria, coleção, material e preço quando houver. Estado de filtros em URL, contagem correta, limpar filtros, nenhum resultado, loading, erro e tentar novamente. Paginação consistente e ordenação estável. Variação e SKU são diferentes de família de produto.

Em modo catálogo: CTA “Consultar esta peça” encaminha atendimento com identificador do produto, ou formulário persistido se contato externo não estiver configurado. Não mostrar botão Comprar/Add ao carrinho se não houver fluxo real aprovado. Páginas dinâmicas inexistentes devem ser 404, não a home.

### 5.3 Formulários que realmente salvam

CAP-FORM: candidatura com nome, WhatsApp, rua, número e cidade conforme A/15; UF e CEP como complemento útil, endereço com opção sem número. Campos de perfil: objetivo financeiro, disponibilidade, experiência, carteira e motivação; separar dados mínimos de perguntas complementares para não sobrecarregar o mobile.

CONT-FORM: nome, canal de retorno, assunto e mensagem; reduzir dados pessoais ao necessário. CONS-FORM: cidade/UF e contato para localizar atendimento quando não houver consultora pública cadastrada.

Todos: validação cliente e servidor, prevenção de submissão duplicada, proteção contra abuso, indicação de envio, confirmação somente após persistência, mensagem de erro recuperável e protocolo. Armazenar origem, URL de entrada, campanha/UTM e indicação quando aplicável, sem dados pessoais em analytics. O formulário deve salvar mesmo sem integração de e-mail; não dizer “e-mail enviado” se só gravou no banco.

Aviso de privacidade acessível e consentimento de marketing separado, opcional e não pré-marcado. Registrar versão do aviso e momento da submissão. Não expor lista de leads ao público. Conversão é disparada após gravação confirmada, uma vez por envio.

## 6. Administração funcional HOJE

Não basta construir uma tela bonita de login. O administrador precisa entrar, editar, publicar, recarregar e encontrar os dados persistidos. Se backend ou credenciais estiverem ausentes, registrar bloqueio e continuar tarefas independentes sem inventar backend.

| ID | Rota | Funções obrigatórias |
| --- | --- | --- |
| ADM-01 | /acesso | Login, sair, sessão expirada, recuperação segura e destino conforme permissão |
| ADM-02 | /admin | Dashboard real: páginas, produtos, leads e pendências; zero em vez de número fictício |
| ADM-03 | /admin/site/paginas | Criar/editar, slug único, rascunho, preview autenticado, publicar/despublicar, histórico |
| ADM-04 | /admin/site/home | Editar textos, CTAs, ordem/visibilidade de seções, imagens e foco por dispositivo |
| ADM-05 | /admin/produtos | Cadastro editorial, imagens/variações, status, busca, filtros e arquivar |
| ADM-06 | /admin/categorias | Criar/editar, slug, capa, descrição, ordem e vínculos |
| ADM-07 | /admin/colecoes | Criar/editar, capa, período, produtos e publicação |
| ADM-08 | /admin/conteudos | Artigos e páginas de captação, revisão, SEO e publicação |
| ADM-09 | /admin/midias | Upload validado, alt, preview, foco, organização e proteção de arquivos em uso |
| ADM-10 | /admin/leads | Lista, busca, filtro, detalhe, responsável, novo/em contato/concluído, notas e histórico |
| ADM-11 | /admin/mensagens | Atendimento recebido, detalhe, status e responsável |
| ADM-12 | /admin/consultoras-publicas | Perfil público autorizado, cidade/UF, contato, ativar/desativar; não o cadastro sensível completo |
| ADM-13 | /admin/configuracoes/site | Contatos oficiais, redes sociais, SEO padrão, logo original e políticas aprovadas |
| ADM-14 | /admin/usuarios | Convites/acessos conforme infraestrutura, papéis, revogar e trilha de alterações |
| ADM-15 | /admin/auditoria | Consulta de eventos sensíveis, filtros e detalhe, sem editar logs |
| ADM-16 | /admin/roadmap | Catálogo privado de requisitos e módulos futuros, estado, dependências e ação “Ver especificação” |

Publicação exige validação de conteúdo essencial, metadados e assets; preview de rascunho não pode ficar público por URL adivinhável. Alteração publicada deve invalidar cache pertinente. Arquivamento preferível a exclusão definitiva; bloquear exclusão de produto/mídia referenciado e explicar o motivo.

Separar perfil Master de Marketing/editor: editor não pode se promover, ver credenciais, custos ou documentos. Diretoria pode consultar visão autorizada. Escopo por recurso e operação; não conceder “admin global” por conveniência. Criar primeiro administrador por procedimento seguro e documentado, sem senha padrão nem cadastro público que vira admin. Proibir autoelevação por campo de formulário, metadata controlada pelo cliente ou endpoint público.

No CMS, adicionar validações e confirmações apropriadas; sucesso somente após commit. Testar salvar, recarregar, sair, entrar novamente e verificar persistência. Não usar localStorage como banco de negócio; preferências visuais podem ser locais. Não aceitar cadastro/mídia só em array do frontend.

## 7. Visual do sistema interno e app futuro

Site: editorial, cinematográfico, leve. Sistema: premium, informativo e eficiente. Compartilhar tokens de marca, mas não colocar vidro animado atrás de tabelas financeiras.

Sistema interno: fundo neutro claro, sidebar organizada, tipografia legível, acentos rosé, contraste alto, tabelas com cabeçalho estável, filtros, pesquisa, paginação, drawer de detalhes, breadcrumbs, status textuais, confirmações e timelines. Cores de alerta devem preservar significado e acessibilidade. Densidade útil, sem gigantismo vazio.

Consultora mobile: poucos toques, botões claros, fotos, resumo do próprio negócio. Home futura responde “Quanto vendi?”, “Quanto tenho para vender?”, “Quanto devo?”, “Quanto falta para minha meta?” e “Qual minha posição?”. Não mostrar interface de ERP à consultora.

Hoje criar o shell privado e o catálogo de módulos com navegação para especificações. Não fabricar dashboards operacionais com valores de demonstração indistinguíveis de dados reais. Uma tela de planejamento não é uma função entregue.

## 8. Rastro de CADA função, botão e estado

Todo requisito abaixo deve ser decomposto em ações atômicas antes de sua implementação. Não deixar “CRUD completo” como única descrição. Para cada criar, editar, arquivar, buscar, filtrar, selecionar, salvar, publicar, exportar, aprovar ou cancelar, criar ACTION-ID estável.

Campos da matriz:

REQ-ID | ACTION-ID | origem/seção | classificação contratual | fase | módulo | rota | rótulo | ator | permissão | pré-condições | entradas/validações | serviço/handler | entidades afetadas | transação | resultado visível | loading/vazio/erro/negado | auditoria | evento analítico permitido | dependências | teste | estado | evidência.

Estados admitidos: DOCUMENTADO, ESTRUTURADO, EM_IMPLEMENTACAO, BLOQUEADO, IMPLEMENTADO_NAO_TESTADO, TESTADO, HOMOLOGADO. “Homologado” só com validação humana registrada; não converter teste automatizado em aceite do cliente.

Exemplos obrigatórios:

- WEB-01/NAV-CANDIDATURA: “Seja Lardan” -> /seja-lardan, acesso público, GET sem mutação; testar desktop, mobile e teclado.
- CAP-FORM/SUBMIT: validar, gravar lead + origem + versão de aviso, devolver protocolo, emitir conversão após sucesso; testar repetição, rede ruim, erro e negação de leitura pública.
- ADM-05/SAVE: autorização no servidor, validar SKU/slug, persistir transação, auditar mudança, invalidar leitura; testar conflito, recarga e acesso sem permissão.
- FIN-01/LIQUIDAR: etapa posterior; vincular recebimento a título, pagamento parcial, saldo residual e auditoria; não criar botão ativo hoje.
- PDV-18/SANGRIA: futuro; caixa aberto, permissão, valor, motivo e aprovação; registro contábil/caixa consistente; não executar hoje.

Padrão para futuros módulos: recurso documentado e desativado tanto no servidor quanto na UI. A ação “Ver especificação” funciona; “Pagar”, “Emitir nota” e “Baixar estoque” não fingem sucesso. Não devolver HTTP 200 com falso sucesso para serviço não implementado.

## 9. Modelo central: preparar sem construir o ERP inteiro hoje

Proposta técnica, adaptar à stack existente sem destruir trabalho anterior. Preferir monólito modular com fronteiras claras a microsserviços prematuros.

Implementar as entidades necessárias ao site: organization, users/profiles, roles/permissions, public_consultant_profiles, media_assets, pages/page_versions, site_settings, categories, collections, products/product_variants/product_media, leads/lead_events, contact_requests e audit_logs. Usar IDs estáveis, timestamps e constraints. organization não significa plataforma pública de revenda de software.

Documentar entidades posteriores, sem aplicar dezenas de migrações prematuras:

- Branch/store, stock_location, supplier, purchase, goods_receipt, lot, tracked_item ou lote/quantidade segundo decisão de rastreio, inventory_movement, reservation.
- Suitcase, suitcase_cycle, suitcase_item, custody_assignment, digital_acceptance, shipment.
- Consultant, representative, region, customer, customer_channel_relationship, interaction, appointment.
- Order, order_item, fulfillment, payment, payment_allocation, receivable, payable, settlement, cost_center, bank_account, reconciliation, commission_rule/version, commission_entry.
- Collection_case, collection_action, promise_to_pay, negotiation, approval_request.
- Return_request, warranty_case, quality_inspection, repair_order.
- Goal, ranking_snapshot, level_rule, campaign, award, badge, referral/mentor_assignment.
- Candidate_profile, recruiting_stage_event, contract_reference, onboarding, course, lesson, quiz, enrollment, progress, certificate.
- Cash_register, cash_session, cash_movement, store_transfer, pickup_order, loyalty_account/event futuro.
- Integration_account, webhook_event, outbox_event e processing_attempt para integrações futuras.

Invariantes:

1. Produto/SKU/variação não são a mesma coisa que uma peça física; localização, responsável e estado são dimensões distintas. Não criar um enum único que impossibilite representar “em maleta e com consultora”.
2. Estoque central, lojas e rede usam a mesma estrutura de localizações/custódia; não criar bancos paralelos por canal.
3. Um cliente pode ter relações com múltiplos canais; não fundir cadastros só por nome. Definir deduplicação por identificadores confiáveis e revisão de conflitos.
4. Origem de venda, consultora, representante e loja precisam ser registráveis; relação comercial não concede leitura irrestrita de dados pessoais.
5. Venda, entrega, recebimento financeiro e disponibilidade física têm estados separados. Não assumir que registrar venda equivale a receber dinheiro.
6. Dinheiro em centavos inteiros ou decimal adequado, nunca floats imprecisos. Pagamento parcial deve ser alocado a títulos; não sobrescrever dívida histórica.
7. Eventos externos podem repetir: idempotência, verificação de autenticidade conforme fornecedor, reconciliação e processamento transacional.
8. Movimentações sensíveis precisam de histórico e estorno, não edição destrutiva do passado.
9. Regras parametrizadas precisam de versão, vigência, responsável e aprovação. Alterar comissão não recalcula o passado sem procedimento explícito.
10. Concorrência: impedir estoque negativo, dupla reserva, dupla baixa e dupla liquidação; planejar locks/constraints/transações apropriadas.

## 10. Inventário completo dos módulos operacionais

Os IDs abaixo são sementes obrigatórias da matriz. Cada ação separada por ponto e vírgula deve receber seu próprio ACTION-ID. Todos os módulos nesta seção são posteriores, salvo a parte editorial/CMS/leads expressamente marcada AGORA.

### CAT — Produtos e catálogo (C/Anexo A/2; A/5)

- CAT-01: cadastrar/editar SKU, código de barras, nome, categoria, coleção, fornecedor, custo, preço, margem, descrição, material, banho, garantia, peso, dimensões e status. Parte editorial agora; custo/margem/fiscal restritos e posteriores.
- CAT-02: vincular/remover imagens e vídeos; ordenar; editar alt; definir imagem principal; validar mídias.
- CAT-03: agrupar por coleção, campanha, temporada e lançamento; publicar editorial agora.
- CAT-04: campanhas específicas por SKU, promoções, incentivos e composição de maleta; relacionar baixo giro e defeitos.
- CAT-05: calcular curva ABC por faturamento, margem, giro ou recorrência com período e critério explícitos.
- CAT-06: parametrizar impostos por estado, operação, alíquota e classificação fiscal após validação contábil.

### EST — Estoque e importações (C/Anexo A/3; A/6)

- EST-01: registrar compra/importação, fornecedor, nota, quantidade, SKU, custo, lote, recebimento e conferência; importar NF-e quando integração for validada.
- EST-02: consultar saldos por localização, custódia, produto, lote e estado; rastrear matriz, representante, consultora, maleta, cliente, retorno, garantia e reparo.
- EST-03: separar, etiquetar, localizar, bloquear/desbloquear e movimentar; registrar origem, destino, responsável e motivo.
- EST-04: reservar, registrar sinal, expirar, liberar e converter reserva; regras de 10 dias e mínimo 40% são exemplos pendentes, não defaults aprovados.
- EST-05: executar inventário completo/cíclico, contar, apontar divergência, solicitar ajuste e aprovar ajuste auditado.
- EST-06: encaminhar para reparo, novo banho, correção, análise ou descarte; peça indisponível até liberação autorizada.
- EST-07: registrar perda, devolução, recebimento de retorno e reintegração; não devolver ao disponível antes de inspeção quando aplicável.
- EST-08: evento de saída física e emissão fiscal quando aplicável dependem de definição formal da Lardan e contabilidade.

### MAL — Maletas (C/Anexo A/4; A/7)

- MAL-01: criar entidade com código, status, peças, valor, quantidade, representante, consultora, localização e histórico.
- MAL-02: montar por busca/bipagem; adicionar/remover peça; conferir composição, coleção e mix; finalizar montagem.
- MAL-03: atribuir responsável; expedir; rastrear; confirmar recebimento; aceite digital com data, maleta, conteúdo, valor e identidade.
- MAL-04: abrir ciclo, acompanhar prazo e consumo, devolver, conferir e recompor.
- MAL-05: manter peças do ciclo anterior, transferindo responsabilidade explicitamente. Caso de teste: 50 itens, 46 devolvidos, 4 mantidos, sem duplicação nem desaparecimento.
- MAL-06: parametrizar duração do ciclo; 42 dias/3 meses são exemplos, validar antes de ativar.
- MAL-07: logística via representante, Sedex, carta registrada ou transportadora conforme viabilidade; rastreio, seguro, custo e prazo.
- MAL-08: perfil e quantidade inteligentes por nível, histórico, recebimento, fiado, inadimplência, região, ticket e comportamento — recomendação futura com aprovação humana.

### REP — Representantes (C/Anexo A/5; A/8)

- REP-01: cadastrar região/carteira, vincular consultoras, metas e permissões.
- REP-02: painel de consultoras, vendas, recebimentos, maletas, metas, cobrança, inadimplência, ranking, candidatas e devoluções, somente carteira autorizada.
- REP-03: agendar/reagendar/concluir visitas, prospecções, cobranças e acompanhamentos.
- REP-04: comissão baseada no efetivamente recebido; simular, apurar, aprovar e consultar memória de cálculo.
- REP-05: consumo de maletas entregues, % vendido/devolvido, prazo e tendências; definir denominador por peças/valor/ciclo.

Faixas de REP-04 inicialmente discutidas em A/8: até 85% recebido -> 9,5%; >85% -> 12,5%; >90% -> 13,5%; >95% -> 14,5%; >=98% -> 16,5%. São parâmetros propostos. Confirmar denominador, período, limites exatos, estornos, taxas e vigência. Testar fronteiras 85/90/95/98 sem sobreposição. Não aplicar em produção sem validação.

### CON/APP — Consultoras e interface mobile (C/Anexo A/6; A/9,19,20)

- CON-01: cadastro privado com dados pessoais, documentos, telefone, e-mail, endereço, PIX, representante, região, entrada, nível e status.
- CON-02: análise de perfil com histórico/performance e eventual Serasa/Assertiva; fornecedor e credenciais pendentes, acesso restrito e revisão humana.
- CON-03: metas individuais agregáveis ao representante; níveis parametrizados Bronze/Prata/Ouro/Diamante.
- APP-01: login celular/e-mail e sessão segura; PIN/biometria/Face ID como possibilidades técnicas dependentes de plataforma, sem promessa de app nativo ou captura de biometria própria.
- APP-02: home com vendas, disponível, devido, progresso da meta e posição, com período e distinção entre vendido e recebido.
- APP-03: Minha Maleta — fotos, peças, quantidades, valores e prazo; aceitar recebimento.
- APP-04: Minha Vitrine — URL própria, copiar/compartilhar link, produtos disponíveis da maleta e identificação pública autorizada.
- APP-05: Registrar Venda — cliente, produto, quantidade e forma de pagamento em poucos toques; obrigatório para vendas da consultora.
- APP-06: Meus Clientes — cadastrar, buscar, editar, histórico, aniversário e preferências sob governança Lardan.
- APP-07: Gerar link para cliente pagar; consultar status; não confundir com pagamento da dívida da consultora.
- APP-08: Pagar Lardan — saldo, títulos, vencimentos, juros e descontos permitidos; iniciar pagamento via integração homologada.
- APP-09: Meu Dinheiro — entradas, vendas, recebimentos, a receber, devido e resultado estimado; não simular conta bancária.
- APP-10: Minha Inadimplência — títulos, vencimentos, juros e negociação.
- APP-11: Minha Meta, Ranking, Nível e Premiações — posição pessoal, Top 10 e campanhas atuais, sem exposição negativa.
- APP-12: Treinamentos/Academy — trilhas, progresso e avaliações.
- APP-13: Troca/Garantia — abrir com fotos e acompanhar.
- APP-14: Contratos e Aceites — visualizar versão e comprovante.
- APP-15: Comunicação com matriz — canal/solicitação conforme escopo; não criar automação WhatsApp não contratada.

Minisite: preferir /consultora/:slug para evitar colisões. A URL curta /:slug exemplificada nos anexos pode ser alias validado de consultora existente, depois das rotas reservadas; nunca wildcard que transforme qualquer URL em 200. Hoje documentar e estruturar; ativação comercial depende de consultora real, disponibilidade e permissões.

### VEN/CRM — Clientes e vendas (C/Anexo A/7; A/10)

- CRM-01: identidade de cliente Lardan, contatos, endereço, aniversário, preferências e histórico de compras.
- CRM-02: interações, frequência, ticket, última compra, campanhas/benefícios de aniversário e recorrência.
- VEN-01: criar pedido, selecionar cliente/SKU/quantidade, validar disponibilidade e desconto, registrar canal e responsável.
- VEN-02: dinheiro, PIX, cartão, link e outros meios autorizados; parcelas e status próprios.
- VEN-03: acompanhar entrega/confirmação e histórico do pedido.
- VEN-04: integrar eventos de venda com estoque, financeiro, ranking e BI; distinguir eventos pendentes de efetivamente confirmados.
- VEN-05: cancelar/estornar com autorização e compensações auditadas; não apagar venda concluída.

### FIN — Financeiro (C/Anexo A/8; A/12)

- FIN-01: contas a receber de consultoras, clientes e outros; criar títulos, parcelas, vencimentos, recebimentos e saldo.
- FIN-02: contas a pagar para fornecedor, salários, marketing, logística, premiações e serviços; categorias, centros de custo e despesas.
- FIN-03: fluxo atual e projeções 30/60/90 dias; separar realizado, previsto e vencido.
- FIN-04: acertos parciais, fiado, múltiplos títulos, juros, descontos autorizados e histórico integral.
- FIN-05: bancos/contas, conciliação, recebimentos, impostos, repasses e relatórios, sem afirmar integração bancária já existente.
- FIN-06: DRE gerencial com competência e categorias explícitas; não confundir com caixa.
- FIN-07: apurar/aprovar comissões e premiações; detalhar base, regra e pagamento, evitando dupla contagem.
- FIN-08: “Pagar Lardan” e pagamento do cliente são fluxos diferentes, com favorecido e alocação definidos.

Caso de teste obrigatório do anexo: devido 26.469; reconhecido 16.955; recebido 11.783; diferença reconhecida 5.172; novo recebimento 5.000 -> residual reconhecido 172, salvo outros ajustes. A diferença entre devido e reconhecido (9.514) não desaparece: manter separada, sob justificativa/decisão, sem tratá-la automaticamente como desconto, recebimento ou baixa.

### ASA/COB — Asaas e CRM de cobrança (C/Anexo A/9; A/12–13)

- ASA-01: integração pretendida para PIX, boleto, cartão, link, cobrança e split quando aplicável.
- ASA-02: criar cobrança, consultar status, processar confirmação, falha, cancelamento, reembolso/estorno quando suportado; idempotência e reconciliação.
- ASA-03: separar sandbox/produção, configuração secreta no servidor, credenciais por contexto e logs sem dados sensíveis.
- COB-01: CRM separado do financeiro operacional, vinculado ao mesmo título, sem duplicar dívida.
- COB-02: timeline de ligação, negociação, promessa, desconto, retorno, follow-up e próxima ação.
- COB-03: régua D+1/D+3/D+7/D+15 como exemplo parametrizável; negativação eventual exige decisão, base/procedimento válido e fornecedor, nunca automática por este prompt.
- COB-04: total vencido, recuperado, prazo médio, taxa de recuperação e cortes por consultora, representante e região.

Integração Asaas não equivale automaticamente a integração com todas as contas bancárias ou terminais de cartão. Validar documentação vigente, capacidades, taxas, contratação e homologação antes da etapa de implementação. Hoje somente adaptadores/documentação e status “não configurado”.

### QUA — Devoluções, garantia e qualidade (C/Anexo A/10; A/11)

- QUA-01: solicitar com produto, descrição, fotos, motivo e compra/histórico.
- QUA-02: analisar, pedir complemento, aprovar, negar com justificativa, trocar, reparar ou encaminhar solução autorizada.
- QUA-03: garantia comercial de 2 anos conforme política definida, vinculada à compra; não inventar exclusões ou cobertura.
- QUA-04: classificar retorno, liberar estoque ou manter bloqueado; reversa e custos quando aplicável.
- QUA-05: BI por SKU, coleção, lote, fornecedor, percentual de retorno/defeito, custo e tempo de resolução.

### GAM — Metas, ranking e premiações (C/Anexo A/11; A/14)

- GAM-01: definir metas e apuração regional, por representante e nacional.
- GAM-02: níveis Bronze/Prata/Ouro/Diamante; progressão e regressão parametrizadas; 120% e retrocesso de um nível são exemplos a confirmar.
- GAM-03: posição pessoal, Top 10/100 e posições próximas; visibilidade autorizada e sem lista pública de piores resultados.
- GAM-04: cadastrar campanha, bônus PIX, dinheiro, produto, viagem ou convenção; elegibilidade, aprovação e concessão.
- GAM-05: marcos de relacionamento de 1 e 2 anos, alerta/contato/presente conforme regra aprovada.
- GAM-06: badges primeira venda, 10 clientes, primeira meta, coleção completa, 1 ano e Top 10; critérios transparentes.

### REC — Recrutamento (C/Anexo A/12; A/15)

- REC-01 AGORA: captar lead e origem, formulário mínimo, protocolo e gestão inicial no admin.
- REC-02 posterior: lead -> formulário -> análise -> contato -> aprovação -> contrato -> onboarding -> primeira maleta -> ativação; histórico de transições e responsável.
- REC-03: registrar objetivo, ambição, disponibilidade, experiência, carteira e motivação; acesso restrito.
- REC-04: IA de classificação inicial opcional/futura, sem decisão discriminatória automática; revisão humana e explicabilidade.
- REC-05: contrato, termos, responsabilidade e privacidade; provedores de assinatura e evidências a definir.
- REC-06: padrinho/madrinha e período de acompanhamento; 10% sobre vendas da indicada com impacto no representante é regra discutida, não produção automática; confirmar base, duração e limites.

### ACA — Onboarding e Lardan Academy (C/Anexo A/13; A/16)

- ACA-01: conteúdo da história, marca, produto, qualidade, garantia, vendas, app, maleta, clientes, pagamentos e ranking.
- ACA-02: criar/editar/publicar vídeos, textos, quizzes, avaliações e trilhas.
- ACA-03: matrícula, progresso, conclusão, tentativas e certificação; eventual liberação de função condicionada à certificação.
- ACA-04: trilha inicial de 7 dias como exemplo validável; continuidade em redes sociais, fotografia, atendimento, finanças, relacionamento e novas coleções.

### BI — Inteligência (C/Anexo A/14; A/17,22,23)

- BI-01: executivo com faturamento, peças/dia, vendas, recebimentos, estoque, maletas, consultoras, representantes, inadimplência, qualidade e ranking.
- BI-02: representante com vendas, maletas, recebimento, inadimplência, ativação e performance da própria carteira.
- BI-03: financeiro, estoque e maletas com métricas reconciliáveis com a fonte; todo KPI define fórmula, período, data de atualização e permissão.
- BI-04: geografia inicialmente PR/SP, heatmap, faturamento, consultoras, expansão e regiões descobertas; agregação que não exponha endereço pessoal.
- BI-05: relógio de consumo da maleta, valor de produtos nas ruas, velocidade de giro e exposição financeira; nunca usar valores ilustrativos como reais.
- BI-06 futuro: churn/inatividade, ruptura, recompra, risco, demanda e recomendação de maleta por histórico, ticket, clientela, região, nível, preços e mix.
- BI-07 futuro: Lardan Score por vendas, pagamento, recorrência, devolução, relacionamento e tempo; impactos em maleta, limite, condições/campanhas precisam aprovação.
- BI-08 futuro: perfil de clientela e malha de risco cruzando estoque em campo, inadimplência, score, tempo e valor.

Não excluir os dashboards expressamente previstos porque o contrato menciona exclusão genérica de BI avançado não previsto. Distinguir BI operacional contratado de predição/IA avançada futura e registrar dúvida quando necessário.

### GOV/INT — Administração, governança e integrações (C/Anexo A/15,17; A/18)

- GOV-01: perfis Master, Diretoria, Financeiro, Cobrança, Estoque, Montagem, Qualidade, Representante, Consultora, Marketing e Suporte.
- GOV-02: departamentos, permissões por ação e contexto, mínimos privilégios, revogação de acesso e testes de isolamento.
- GOV-03: parâmetros de comissão, desconto, garantia, prazos, score e aprovações; versão/vigência.
- GOV-04: dupla aprovação possível para comissão, cancelamento de cobrança, estoque, exclusão e grandes descontos.
- GOV-05: auditoria de usuário, ação, data, valores anterior/novo e motivo; logs imutáveis para usuários comuns.
- GOV-06: segurança, backup, restauração e privacidade; definir política operacional sem inventar retenção/SLA.
- INT-01: Asaas, fiscal, bancos, bureaus, logística, Correios, APIs financeiras, comunicação e contabilidade; todos com matriz de disponibilidade/documentação/credenciais/custos/homologação.

## 11. PDV futuro — rastro integral dos 47 itens do anexo

Origem P/1–47; C/Anexo A/16. Hoje: desenho de entidades, contratos, permissões, rotas e requisitos. Não entregar PDV operacional nem afirmar contingência funcional. /loja é privado e protegido. Nada disso pode atrasar o site.

| ID/fonte | Capacidade e ações futuras a registrar |
| --- | --- |
| PDV-01 | Multi-loja, multi-filial, multiusuário; unidades, quiosques, shopping, rua e eventual franquia; consolidação matriz |
| PDV-02 | Tela rápida desktop/tablet/touch: busca/bipagem e carrinho com foto, nome, SKU, preço, quantidade, desconto e subtotal |
| PDV-03 | Leitor USB, câmera ou busca manual; identificar produto, preço, estoque, unidade e disponibilidade |
| PDV-04 | Adicionar/remover item, mudar quantidade, desconto autorizado, associar cliente, escolher pagamento e totalizar |
| PDV-05 | Localizar/criar cliente com nome, CPF quando necessário, celular, e-mail, aniversário e cidade |
| PDV-06 | CRM omnichannel: consolidar compras por consultora, site e lojas na identidade Lardan |
| PDV-07 | Dinheiro, PIX, débito, crédito, parcelas, links; Asaas/adquirente a definir |
| PDV-08 | Pagamento em múltiplos meios; exemplo 300 PIX + 700 cartão; alocação consistente |
| PDV-09 | Baixa da unidade ao finalizar conforme regra validada; teste saldo 5 menos 2 resulta 3 |
| PDV-10 | Estoque independente por loja e saldos de matriz/representante/consultora, consolidados |
| PDV-11 | Transferência: solicitar, aprovar, separar, expedir, receber, aceitar; tudo auditado |
| PDV-12 | Consulta global: onde existe; futura reserva, transferência, envio ou retirada em outra unidade |
| PDV-13 | Reserva com cliente, produto, loja, prazo, sinal, estado e expiração |
| PDV-14 | Click & collect: recebido, separação, reservado, cliente avisado, retirada e conclusão |
| PDV-15 | Ship from store: expedir pedido online por unidade; decisão logística futura |
| PDV-16 | Abrir caixa com loja, caixa, operador, data/hora e saldo inicial |
| PDV-17 | Fechar/conferir caixa: esperado vs informado, vendas, meios, cancelamentos, descontos, devoluções, sangrias e suprimentos |
| PDV-18 | Sangria: valor, motivo, operador, horário e aprovação |
| PDV-19 | Suprimento: entrada de dinheiro e auditoria |
| PDV-20 | Cancelar venda com permissão, gerente/reautenticação e justificativa; não apagar histórico |
| PDV-21 | Limites de descontos por perfil; 5% vendedor/15% gerente são exemplos, não regras ativas |
| PDV-22 | Buscar venda por CPF/telefone/pedido/data; troca, crédito, devolução e garantia; classificar retorno |
| PDV-23 | Garantia de 2 anos vinculada à compra e CRM; abrir e acompanhar solicitação |
| PDV-24 | Atribuir vendedor; faturamento, ticket, peças, conversão, meta, comissão e ranking |
| PDV-25 | Definir meta mensal por loja; valores do anexo são exemplos |
| PDV-26 | Distribuir meta aos vendedores; realizado, projeção e percentual |
| PDV-27 | Comissão parametrizada por vendido/recebido, categoria, campanha ou meta; memória de cálculo |
| PDV-28 | Ranking de lojas por unidade/shopping/cidade/UF; faturamento, ticket, peças/venda, margem, crescimento e conversão |
| PDV-29 | Ranking de vendedores e conexão a campanhas, reconhecimento, premiação e convenção |
| PDV-30 | BI gerente: hoje, meta, ticket, clientes, peças/venda, produtos, estoque crítico, vendedor e meios |
| PDV-31 | BI diretoria: lojas + e-commerce + consultoras; consolidação sem dupla contagem |
| PDV-32 | Indicador peças por venda, denominador de pedidos elegíveis e evolução |
| PDV-33 | Conversão dependente de contador de fluxo; sem fluxo medido, “indisponível”, não zero inventado |
| PDV-34 | Estoque parado por loja/SKU e tempo sem giro; identificar redistribuição |
| PDV-35 | IA de rebalanceamento futura; sugerir transferência e exigir aprovação |
| PDV-36 | Preço nacional/regional, promoções/campanhas e tributação por estado/unidade |
| PDV-37 | NF-e/NFC-e ou documento aplicável via solução fiscal e definição contábil |
| PDV-38 | Cliente 360: todos canais, frequência, ticket, aniversário, preferências, garantias e devoluções |
| PDV-39 | Lardan Club futuro: pontos, cashback, níveis, benefícios, aniversário, acesso antecipado e eventos |
| PDV-40 | Relação loja × consultora: reconhecer vínculo e parametrizar atribuição sem inventar repasse |
| PDV-41 | Cadastro da loja: nome, CNPJ, endereço, shopping, cidade/UF, gerente, estoque, caixas, equipe, metas e horário |
| PDV-42 | Gerente, Caixa, Vendedor, Estoquista, Supervisor regional e Diretoria; permissões próprias |
| PDV-43 | Auditar desconto, cancelamento, troca/devolução, sangria, estoque, transferência e fechamento |
| PDV-44 | Estudar contingência fiscal/pagamento conforme integração; não presumir pagamento confirmado offline |
| PDV-45 | Jornada omnichannel sem três sistemas paralelos, preservando identidade e governança |
| PDV-46 | Fluxo ponta a ponta atendimento -> bipagem -> cliente -> carrinho -> pagamento -> fiscal -> estoque -> CRM/metas/comissão/financeiro/BI; coordenar falhas e pendências sem duplicação |
| PDV-47 | Expansão de uma unidade para rede; arquitetura atual sem bloqueios estruturais |

## 12. Segurança e separação de ambientes

Autenticação não é autorização. Toda operação privada precisa de autorização no servidor e, com Supabase, políticas RLS adequadas e testadas. Publicações e dados públicos devem ter consultas limitadas. Usuário anônimo não lê leads, contatos, documentos, notas internas, custos ou auditoria.

Não colocar service role, segredo de webhook, credencial de pagamento ou certificado fiscal no frontend, variável pública, código versionado ou log. Sanitizar conteúdo CMS para impedir XSS; validar upload por tipo/tamanho e política de acesso. Documentos privados em storage privado; mídias editoriais públicas somente após aprovação.

Proteger formulários contra abuso e duplicidade; recuperação de senha sem revelar existência de contas. Sem credencial padrão. Sem botão que altere permissão apenas no cliente. Políticas administrativas não podem permitir editar o próprio papel para Master.

Separar homologação/produção. Não apagar dados reais, reiniciar banco, recriar projeto, publicar domínio ou disparar convites/mensagens externas sem autorização adequada. Para testes, usar dados controlados e identificados; nunca misturar demonstrações com indicadores reais.

Configurar backup conforme infraestrutura disponível, documentar frequência/retenção efetiva e testar restauração quando possível. Se não executou restauração, registrar pendente. Consentimento, retenção e textos legais finais dependem de validação; não declarar conformidade absoluta apenas por adicionar banner.

## 13. SEO técnico e conteúdo: critério da entrega atual

Páginas públicas com conteúdo útil no HTML inicial usando renderização compatível com a plataforma; não basta preencher meta tags após JS. Conferir resposta HTTP e HTML entregue. Se houver limitação da hospedagem, registrar e propor solução suportada; não inventar SSR.

Cada rota publicada: title/description únicos, canonical correto, H1 coerente, headings ordenados, links internos reais e Open Graph. Sitemap apenas de URLs publicadas canônicas e indexáveis. robots não bloqueia assets necessários. /admin, /sistema, /app, /loja, rascunhos e ambientes de teste sem indexação; robots/noindex não substituem autenticação.

404 HTTP real para slug inexistente; redirects consistentes entre www/apex e URLs antigas quando existirem. Não substituir toda rota desconhecida pela home. Dados estruturados somente verdadeiros: Organization, BreadcrumbList, Article e Product quando houver produto real e dados correspondentes. Sem avaliações inventadas, preço fictício ou FAQ invisível. Não prometer rich results ou presença garantida em IAs.

Opcional técnico: llms.txt conciso, derivado do conteúdo público aprovado, sem informações privadas e sem promessa de indexação. Privilegiar HTML acessível, performance, links e conteúdo real.

Eventos de navegação, CTA, produto e candidatura com IDs estáveis; não enviar nome, telefone, e-mail, endereço ou documentos para analytics. Integrações de medição só após configuração e políticas aplicáveis; ausência de GA4 não impede persistência de lead.

## 14. Ordem de execução: lotes curtos e verificáveis

### Lote 0 — Ler, preservar e mapear

Inspecionar projeto/stack/backend/assets existentes sem apagar nada. Ler fontes, criar documentação e checkpoint. Registrar dependências e o limite “site primeiro”. Estruturar matriz de todos os módulos e 47 itens do PDV; detalhar ações do site/admin antes de implementá-las. Não gastar a sessão criando telas operacionais futuras.

### Lote 1 — Fundação visual e primeira experiência

Importar assets e logo; tokens; layout público; menu; hero aprovado; três estados do scroll; transição para primeira categoria; versão mobile e reduced motion. Criar shell administrativo protegido sem dados falsos. Verificar build e layout. Se a logo original não estiver disponível, bloquear sua reprodução, não redesenhar.

### Lote 2 — Backend e admin editorial

Migrações mínimas, autenticação, permissões, políticas, storage, CMS, categorias, coleções, produtos editoriais e mídia. Implementar publicar/rascunho/preview. Provar persistência e isolamento antes de avançar.

### Lote 3 — Site completo e conteúdo

Concluir home, 15 páginas principais, rotas auxiliares, detalhes de produto/coleção/conteúdo e 15 páginas de captação. Conteúdo original com fatos aprovados e rascunhos identificados quando faltarem dados. Busca, filtros, navegação e estados completos.

### Lote 4 — Captação, contato e operação do admin

Formulários persistentes, protocolo, proteção contra abuso, gestão de leads e mensagens, consultoras públicas autorizadas, configurações e auditoria. Testar público -> gravação -> admin -> edição/status -> recarga. Comunicação externa não configurada deve ser declarada, sem simulação de envio.

### Lote 5 — Qualidade, SEO e auditoria adversarial

Testar matriz completa do site/admin, mobile, teclado, performance, HTTP/HTML, banco/permissões, formulários, uploads, vazamento e fluxos de erro. Corrigir falhas antes de dizer pronto. Capturar evidências.

### Lote 6 — Rastro final e handoff

Consolidar inventário atômico de ações de todos os módulos, rotas reservadas, dependências, modelo futuro e roadmap privado. Manter funcionalidades futuras desativadas. Entregar relatório honesto da fase atual, sem iniciar ERP/PDV sem nova ordem.

Ao concluir cada lote: salvar checkpoint, executar testes pertinentes e informar progresso. Se um lote for grande, subdividir em 2A/2B etc. Não se limitar a responder com plano: implemente o lote autorizado. Se houver bloqueio em uma tarefa, avançar nas independentes sem esconder a pendência.

## 15. Testes de aceite obrigatórios

### Fluxos públicos

- Abrir home em desktop e mobile; menu e identidade corretos, sem texto gravado na imagem, sem joias no primeiro estado.
- Scroll: diamante -> nome isolado -> conteúdo/joia; movimento reversível estável e conteúdo acessível sem efeitos.
- Cada link do menu chega ao destino correto; todos os CTAs de categoria funcionam.
- Busca encontra produto real pelo termo/SKU; filtros podem ser combinados e limpos; URL recarregável.
- Produto inexistente, coleção inexistente e conteúdo inexistente retornam 404 real.
- Lead válido salva uma vez, gera protocolo e aparece no admin; rede ruim/reenvio não duplica.
- Formulário inválido não salva; API recusa entrada inválida mesmo sem validação frontend.
- Contato e solicitação de consultora funcionam sem depender de WhatsApp ou e-mail configurados.
- Nenhum CTA de pagamento aparece como operacional enquanto checkout estiver desativado.

### Administração e dados

- Anônimo não acessa admin nem suas APIs/dados.
- Marketing edita conteúdo autorizado, mas não altera papéis nem lê informações financeiras privadas.
- Criar produto -> salvar -> recarregar -> editar -> publicar -> conferir site -> despublicar -> conferir indisponibilidade pública.
- Slug duplicado falha de modo compreensível; alteração concorrente não sobrescreve sem controle.
- Upload válido funciona; upload inválido é bloqueado; mídia referenciada não desaparece por exclusão indevida.
- Rascunho não aparece no sitemap nem por API pública; preview exige autorização.
- Ação sensível gera evento de auditoria sem vazar segredo; usuário comum não modifica log.
- Logout e sessão expirada bloqueiam operação; recuperação de acesso testada quando provedor disponível.

### Qualidade técnica

- Build, lint e testes aplicáveis passam; sem erro de console, link quebrado, botão sem handler ou formulário falso.
- Layout nas cinco larguras, teclado, foco, zoom e redução de movimento.
- HTML inicial contém conteúdo relevante, canonical e metadados; status HTTP e sitemap verificados.
- Medições de performance com ambiente/método registrados; orçamento de imagem e JS revisado.
- Nenhum custo/margem, dado privado, contrato ou credencial retornado em endpoint público.
- Testar não apenas tela feliz, mas loading, vazio, offline/erro, negação, duplicidade e retentativa.

Não marcar “testado” com base em leitura de código. Distinguir executado, inspecionado e não testado. Nunca inventar screenshot, nota de Lighthouse, resultado de query ou teste E2E.

## 16. Decisões e materiais pendentes: registrar sem inventar

Confirmar identidade empresarial pública: os documentos apresentam grafias diferentes de razão social em qualificação e assinatura. Não copiar dado ambíguo para o rodapé. Confirmar endereço público, WhatsApp de atendimento, e-mail, redes e domínio.

Solicitar apenas quando necessário: catálogo real, SKUs, imagens reais, preços, materiais/banho, estoque, políticas de garantia/troca, textos institucionais, depoimentos autorizados, contatos de consultoras publicáveis e aprovação editorial das imagens conceituais.

Integrações: Asaas, fiscal, bancos, logística, bureaus e assinatura dependem de documentação, credenciais, custos e homologação. Não inserir segredo no chat. Pagamentos/checkout de produção, comissionamento, impostos, reserva, regras de canal, atribuição comercial, prazos de maleta, comissão de padrinho e critérios de ranking exigem validação.

Dados faltantes não autorizam inventar “20 anos de história”, volume de clientes, banho em micras, hipoalergenicidade, ouro maciço, produto exclusivo/autoral ou ganhos garantidos. Não publicar IA/modelo editorial como depoimento real. Não coletar dados excessivos só porque um módulo futuro os terá.

Enquanto aguarda conteúdo, deixar rascunho privado com pendência explícita. Diferenciar “tecnicamente implementado” de “liberado para produção”. Não usar “site completo” para esconder ausência de credenciais, conteúdo essencial ou validação.

## 17. Relatório final obrigatório

Responder com:

1. O que funciona hoje, com rotas e evidências.
2. O que está implementado, mas não testado.
3. O que falta para publicar, se houver.
4. Páginas implementadas/publicadas/rascunhos: contagens e lista.
5. Login/admin, procedimento seguro de primeiro acesso e funções disponíveis.
6. Matriz de botões/ações: quantos documentados, implementados e testados, sem estimar valores não apurados.
7. Módulos posteriores documentados e desativados; PDV com seus 47 itens rastreados.
8. Pendências da Lardan/Diego, fornecedores e homologação.
9. Último checkpoint e comando de continuação, caso qualquer item esteja incompleto.

Não afirmar que todo o Lardan Cloud foi entregue. A entrega desta execução é site e administração editorial; fundação e rastreabilidade preparam o restante. A qualidade exigida é verificável: bonito, funcional, persistente, seguro, responsivo e sem botões fantasmas.

# FIM DA ESPECIFICAÇÃO
