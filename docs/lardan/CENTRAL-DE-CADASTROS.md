# Central de Cadastros — LARDAN Cloud

## Princípio inegociável
A Central **não cria uma segunda base**. Ela é a porta única para os mesmos registros
usados pelos módulos especializados. Uma consultora cadastrada aqui aparece em
Consultoras; um fornecedor criado aqui é o mesmo usado em Produtos, Compras e
Financeiro; um produto criado aqui é o mesmo da Vitrine, Estoque e Site.

## Rota
- Canônica: `/admin/cadastros` (evoluída, não substituída).
- Listagem de identidades: `/admin/cadastros/pessoas`.
- Ficha completa: `/admin/cadastros/pessoas/$id`.
- Revisão de duplicidades: `/admin/cadastros/duplicidades`.
- Módulos existentes preservados: `produtos`, `categorias`, `colecoes`,
  `fornecedores`, `locais`, `entidades`.

## Menu inferior
Nova entrada **Cadastro** (ícone `ContactRound`), mesmo tamanho, espessura e
comportamento dos demais; estado ativo em champagne; abre `/admin/cadastros`.
O antigo item que se chamava "Produtos" e apontava para `/admin/cadastros`
virou um módulo próprio apontando para `/admin/cadastros/produtos`, de modo que
nenhum atalho foi removido.

## Modelo canônico
| Tabela | Papel |
| --- | --- |
| `parties` | identidade única de pessoa ou organização, com `code` (`LC-000001`) e `doc_digits` normalizado |
| `party_roles` | papéis acumuláveis (consultora, cliente, fornecedora, colaboradora…) |
| `contact_points` | WhatsApp, telefone, e-mail |
| `party_addresses` | endereços |
| `party_links` | vínculo 1:1 com o registro especializado (`supplier`, `business_entity`, `profile`, `lead`, `location`, `contact_request`) |
| `consultant_profiles` | ficha comercial e financeira da consultora |

Migração **aditiva**: as tabelas antigas ganharam `party_id`; nenhum ID foi trocado,
nenhuma migração anterior foi alterada, nenhum cadastro foi fundido automaticamente.

## Busca inteligente
`search_registry(_term, _limit)` no servidor: por nome, nome social, código interno,
documento normalizado, telefone, e-mail, SKU, código de barras, código legado,
produto, categoria, coleção, fornecedor, entidade e local. Debounce de 280 ms,
cancelamento da consulta anterior, agrupamento por tipo e navegação direta à ficha.
Nunca baixa a base para o navegador.

## CPF e CNPJ
Sem consulta externa: máscara, normalização, validação matemática dos dígitos,
rejeição de sequências repetidas e detecção de duplicidade. Estados possíveis:
não informado, inválido, estruturalmente válido, duplicado. O sistema **nunca**
afirma que o documento pertence à pessoa. Exibição mascarada por padrão;
número completo apenas com `registry.doc.view`.

## Permissões
| Capacidade | Significado |
| --- | --- |
| `registry.view` | pesquisar e consultar cadastros |
| `registry.manage` | criar e editar |
| `registry.doc.view` | ver documento completo |
| `registry.finance.view` | ver PIX e dados financeiros |

Marketing tem apenas `registry.view`. Estoque idem. Financeiro e Cobrança veem
dados financeiros. Master e Diretoria têm tudo. Exclusão física de pessoa com
histórico não existe — só inativação.

## Conversão candidata → consultora
`convert_lead_to_consultant(_lead_id, _party_id)` é transacional e idempotente:
localiza ou cria a identidade, preserva protocolo, origem, UTM e consentimentos da
candidatura, cria o papel de consultora, registra auditoria e devolve o `party_id`.
Nenhum login é criado automaticamente. Disponível no botão "Converter em consultora"
na tela de candidaturas.

## Formulário progressivo
Abas: Resumo, Identificação, Contatos, Endereços, Dados comerciais, Financeiro/PIX,
Vínculos, Estoque e maletas, Acesso, Histórico. Rascunho salva sem nenhum campo
comercial obrigatório, com código interno gerado automaticamente, percentual de
completude, aviso de alterações não salvas e nome nunca preenchido com "Sem nome".

## Em implantação
Revendedoras, representantes, clientes, prestadores, transportadoras, lojas,
biblioteca de imagens, tabelas de preço, maletas, regiões, motivos de movimentação,
códigos de barras e todo o bloco financeiro aparecem com selo **Em implantação** e
sem botão que finja funcionar.
