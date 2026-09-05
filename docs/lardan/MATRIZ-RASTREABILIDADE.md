# LARDAN — Matriz de Rastreabilidade

Estados admitidos: DOCUMENTADO, ESTRUTURADO, EM_IMPLEMENTACAO, BLOQUEADO, IMPLEMENTADO_NAO_TESTADO, TESTADO, HOMOLOGADO.
"HOMOLOGADO" exige validação humana registrada; teste automatizado não é aceite do cliente.

Campos: REQ-ID | ACTION-ID | origem | classificação | fase | rota | ator | permissão | resultado visível | estado | evidência.

## Site público — AGORA

| REQ | ACTION | Origem | Classe | Rota | Ator | Resultado | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WEB-01 | HERO-SCROLL-D1 | V/4.1 | OBRIGAÇÃO | / | público | Diamante nítido na entrada, sem joia/texto/CTA | IMPLEMENTADO_NAO_TESTADO |
| WEB-01 | HERO-SCROLL-D2 | V/4.1 | OBRIGAÇÃO | / | público | Diamante dissolve em névoa rosé sutil | IMPLEMENTADO_NAO_TESTADO |
| WEB-01 | HERO-SCROLL-D3 | V/4.1 | OBRIGAÇÃO | / | público | Wordmark LARDAN isolado, sem símbolo | IMPLEMENTADO_NAO_TESTADO |
| WEB-01 | HERO-SCROLL-D4 | V/4.1 | OBRIGAÇÃO | / | público | Título, subtítulo, CTA e primeira categoria | IMPLEMENTADO_NAO_TESTADO |
| WEB-01 | HERO-REDUCED-MOTION | V/4.3 | OBRIGAÇÃO | / | público | Conteúdo essencial sem animação | IMPLEMENTADO_NAO_TESTADO |
| WEB-01 | NAV-ALARDAN | V/5 | OBRIGAÇÃO | /a-lardan | público | Navegação real (sem href="#") | IMPLEMENTADO_NAO_TESTADO |
| WEB-01 | NAV-SEMIJOIAS | V/5 | OBRIGAÇÃO | /semijoias | público | Navegação real | IMPLEMENTADO_NAO_TESTADO |
| WEB-01 | NAV-COLECAO | V/5 | OBRIGAÇÃO | /colecoes | público | Navegação real | IMPLEMENTADO_NAO_TESTADO |
| WEB-01 | NAV-CANDIDATURA | V/8 | OBRIGAÇÃO | /seja-lardan | público | GET sem mutação; testar desktop/mobile/teclado | IMPLEMENTADO_NAO_TESTADO |
| WEB-01 | NAV-CONTATO | V/5 | OBRIGAÇÃO | /contato | público | Navegação real | IMPLEMENTADO_NAO_TESTADO |
| WEB-01 | CTA-CATEGORIA-ANEIS | V/4.2 | OBRIGAÇÃO | /semijoias/aneis | público | CTA real da cena de anéis | IMPLEMENTADO_NAO_TESTADO |
| WEB-01 | CTA-CATEGORIA-COLARES | V/4.2 | OBRIGAÇÃO | /semijoias/colares | público | CTA real da cena de colares | IMPLEMENTADO_NAO_TESTADO |
| WEB-01 | CTA-CATEGORIA-PULSEIRAS | V/4.2 | OBRIGAÇÃO | /semijoias/pulseiras | público | Cena pendente de imagem aprovada | BLOQUEADO (asset) |
| WEB-01 | CTA-CATEGORIA-BRINCOS | V/4.2 | OBRIGAÇÃO | /semijoias/brincos | público | Cena pendente de imagem aprovada | BLOQUEADO (asset) |
| WEB-01 | ACESSO-DISCRETO | V/4.2 | OBRIGAÇÃO | /acesso | público | Link "Acessar Lardan" no rodapé | IMPLEMENTADO_NAO_TESTADO |
| WEB-02 | CAT-BUSCA | V/5.2 | OBRIGAÇÃO | /semijoias | público | Busca por nome/SKU em dados reais | DOCUMENTADO (Lote 3) |
| WEB-02 | CAT-FILTROS | V/5.2 | OBRIGAÇÃO | /semijoias | público | Filtros combináveis, estado na URL, limpar | DOCUMENTADO (Lote 3) |
| WEB-02 | CAT-ESTADOS | V/5.2 | OBRIGAÇÃO | /semijoias | público | Loading, vazio, erro, tentar novamente | DOCUMENTADO (Lote 3) |
| WEB-11 | ALARDAN-CONTEUDO | V/5 | OBRIGAÇÃO | /a-lardan | público | História aprovada; sem fato inventado | ESTRUTURADO (rascunho, conteúdo pendente) |
| WEB-12 | GARANTIA-CONTEUDO | V/4.2 | OBRIGAÇÃO | /qualidade-e-garantia | público | Garantia de 2 anos conforme política aprovada | DOCUMENTADO |
| WEB-14 | CAP-FORM/SUBMIT | V/5.3, V/8 | OBRIGAÇÃO | /seja-lardan | público | Validar, gravar lead+origem+versão de aviso, devolver protocolo, conversão após sucesso | DOCUMENTADO (Lote 4) |
| — | CONT-FORM/SUBMIT | V/5.3 | OBRIGAÇÃO | /contato | público | Persistência e protocolo sem depender de e-mail | DOCUMENTADO (Lote 4) |
| WEB-13 | CONS-FORM/SUBMIT | V/5.3 | OBRIGAÇÃO | /encontre-uma-consultora | público | Busca cidade/UF e solicitação de atendimento | DOCUMENTADO (Lote 4) |
| — | ERRO-404 | V/13 | OBRIGAÇÃO | * | público | 404 HTTP real; nunca home | IMPLEMENTADO_NAO_TESTADO |

## Admin — AGORA

| REQ | ACTION | Origem | Rota | Permissão | Resultado | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| ADM-01 | LOGIN | V/6 | /acesso | público→autenticado | Entrar, sair, sessão expirada, recuperação segura | ESTRUTURADO (backend no Lote 2) |
| ADM-02 | DASH-CONTAGENS | V/6 | /admin | autenticado | Páginas, produtos, leads, pendências; zero real, nunca fictício | ESTRUTURADO |
| ADM-03 | PAGINA-SAVE/PUBLICAR | V/6 | /admin/site/paginas | editor+ | Slug único, rascunho, preview autenticado, publicar/despublicar, histórico | DOCUMENTADO (Lote 2) |
| ADM-04 | HOME-EDIT | V/6 | /admin/site/home | editor+ | Textos, CTAs, ordem/visibilidade, imagens, foco por dispositivo | DOCUMENTADO (Lote 2) |
| ADM-05 | SAVE | V/8 | /admin/produtos | editor+ | Autorização no servidor, validar SKU/slug, transação, auditoria, invalidar leitura | DOCUMENTADO (Lote 2) |
| ADM-09 | MIDIA-UPLOAD | V/6 | /admin/midias | editor+ | Upload validado, alt, foco, proteção de arquivo em uso | DOCUMENTADO (Lote 2) |
| ADM-10 | LEAD-STATUS | V/6 | /admin/leads | comercial+ | novo/em contato/concluído, notas, histórico | DOCUMENTADO (Lote 4) |
| ADM-14 | PAPEL-ALTERAR | V/6,12 | /admin/usuarios | master | Papéis em tabela separada; proibida autoelevação | DOCUMENTADO (Lote 2) |
| ADM-15 | AUDITORIA-CONSULTAR | GOV-05 | /admin/auditoria | master/diretoria | Consulta com filtros; log imutável | DOCUMENTADO (Lote 2) |
| ADM-16 | VER-ESPECIFICACAO | V/8 | /admin/roadmap | autenticado | Abre especificação do módulo futuro; nenhuma ação operacional ativa | ESTRUTURADO |

## Módulos posteriores — sementes obrigatórias (todos DOCUMENTADO e DESATIVADOS)

CAT-01..06; EST-01..08; MAL-01..08; REP-01..05; CON-01..03; APP-01..15; CRM-01..02; VEN-01..05; FIN-01..08; ASA-01..03; COB-01..04; QUA-01..05; GAM-01..06; REC-01..06 (REC-01 é AGORA via CAP-FORM); ACA-01..04; BI-01..08; GOV-01..06; INT-01; PDV-01..47.

Cada ação separada por ponto e vírgula na MASTER-SPEC recebe ACTION-ID próprio ao entrar em implementação. Exemplos já fixados:
- FIN-01/LIQUIDAR — etapa posterior; nenhum botão ativo hoje.
- PDV-18/SANGRIA — futuro; caixa aberto, permissão, valor, motivo, aprovação; não executar hoje.
Padrão: recurso desativado no servidor **e** na UI; "Ver especificação" funciona; nenhuma ação finge sucesso; nunca HTTP 200 com falso sucesso.

## Central de Cadastros (L3.5)
| ID | Ação | Rota | Papéis | Regra | Estado |
| --- | --- | --- | --- | --- | --- |
| CAD-01 | CENTRAL-ABRIR | /admin/cadastros | registry.view | Porta única; nunca duplica registros | ATIVO |
| CAD-02 | BUSCA-UNIFICADA | /admin/cadastros | registry.view | Servidor, debounce, cancelamento, RLS, mascaramento | ATIVO |
| CAD-03 | PESSOA-LISTAR | /admin/cadastros/pessoas | registry.view | Paginação/ordenação/filtro no servidor | ATIVO |
| CAD-04 | PESSOA-CRIAR/EDITAR | /admin/cadastros/pessoas/$id | registry.manage | Rascunho sem obrigatoriedade comercial; código automático | ATIVO |
| CAD-05 | PAPEL-VINCULAR | /admin/cadastros/pessoas/$id | registry.manage | Papéis acumuláveis sem duplicar pessoa | ATIVO |
| CAD-06 | DOC-VER-COMPLETO | /admin/cadastros/pessoas/$id | registry.doc.view | Validação apenas estrutural; nunca afirma titularidade | ATIVO |
| CAD-07 | PIX-VER | /admin/cadastros/pessoas/$id | registry.finance.view | Marketing e Estoque nunca veem | ATIVO |
| CAD-08 | DUPLICIDADE-REVISAR | /admin/cadastros/duplicidades | registry.view | Aponta, nunca funde automaticamente | ATIVO |
| CAD-09 | CANDIDATA-CONVERTER | /admin/leads | registry.manage + leads.view | Transacional, idempotente, sem login automático, auditado | ATIVO |
