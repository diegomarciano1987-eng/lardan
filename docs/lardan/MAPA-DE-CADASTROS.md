# LARDAN Cloud — Mapa de Cadastros (para validação do Daniel)

Documento de conferência. Para cada cadastro: **onde fica**, **o que se preenche hoje**,
**para que serve / o que alimenta** e **o que ainda falta**.
Ao final há um espaço para o Daniel marcar OK ou pedir ajuste.

Ponto de partida de tudo: **Cadastro** (menu inferior) → `/admin/cadastros`.
Nessa tela há a busca inteligente (nome, documento, telefone, e-mail, SKU, código de barras,
código legado, produto, categoria, coleção, fornecedor, local) e o botão **Novo cadastro**.

---

## 1. PRODUTO — o cadastro mais importante

### Caminho
Cadastro → **Produtos** → `/admin/cadastros/produtos`
Botão **Novo produto** → depois abre a **ficha do produto** (`/admin/cadastros/produtos/{id}`).

### Sim, são duas etapas
**Etapa 1 — Novo produto (janela rápida).** Só o essencial para o produto nascer:

| Campo | Obrigatório | Para que serve |
| --- | --- | --- |
| Nome do produto | Sim | Nome que aparece no site e em todas as listas |
| Código legado | Não | Código antigo/planilha, usado na busca e na importação |
| Endereço (slug) | Não | Endereço da página no site; se vazio, é gerado pelo nome |
| Categoria | Não | Em que página de categoria a peça aparece |
| Coleção | Não | Agrupamento temático |
| Resumo | Não | Texto curto usado nas listagens |

O produto nasce como **rascunho** (não aparece no site) e o sistema já abre a ficha completa.

**Etapa 2 — Ficha do produto.** Tem quatro blocos.

**a) Editar ficha** (botão no topo):

| Campo | Para que serve |
| --- | --- |
| Nome / Endereço (slug) / Código legado | Identificação e endereço da página |
| Categoria / Coleção / Fornecedor | Onde aparece no site e de quem veio a peça |
| Situação (rascunho, revisão, publicado, arquivado) | Controla se está no ar |
| Preço (R$) | Preço público da peça |
| Mostrar preço no site (liga/desliga) | Permite peça sem preço visível |
| Destaque na vitrine (liga/desliga) | Coloca a peça nos destaques da home |
| Material, Banho, Medidas, Peso (g) | Ficha técnica exibida na página do produto |
| Resumo, Descrição completa | Textos de venda |
| Cuidados, Garantia | Textos de pós-venda na página |
| Título para buscadores, Descrição para buscadores | Como a peça aparece no Google |

**b) Variantes vendáveis** (botão **Nova variante**) — é a variante que é vendida e contada em estoque:

| Campo | Para que serve |
| --- | --- |
| Nome da variante | Ex.: "Aro 16", "Dourado" |
| SKU | Código único de venda e estoque |
| Código de barras | Leitura por leitor/etiqueta |
| Código legado | Código antigo |
| Tamanho / Cor | Opções que a cliente escolhe no site |
| Preço (R$) | Preço específico da variante (se diferente) |
| Ordem | Ordem de exibição |
| Variante padrão / Ativa | Qual vem selecionada e se ainda é vendida |
| Novo custo (R$), Fornecedor do custo, Observação do custo | Só para Master/Diretoria/Financeiro. Guarda histórico de custo com data |

**c) Imagens:** enviar foto, definir a **principal**, reordenar, escrever a **descrição da imagem**
(usada por leitores de tela e pelo Google) e remover.

**d) Preço público e Histórico:** resumo do preço e registro de tudo que foi alterado, com data.

### O que este cadastro alimenta
Site (home, categoria, página do produto e busca) · Sacola · Estoque (por variante) ·
Reservas · Importação industrial · Custos e futuro Financeiro · Auditoria.

### Regras já ativas
- Só publica com o que é obrigatório preenchido; se faltar algo, o sistema diz exatamente o que falta.
- Nada é excluído: arquiva-se.
- Custo nunca aparece para quem não tem permissão.

### Pontos para o Daniel decidir
- Falta cadastro de **pedra/gema, coleção do fornecedor, prazo de reposição e peso por variante**?
- Preço de **revenda/consultora** (tabela de preços) ainda não existe — está previsto.
- **Biblioteca de imagens** compartilhada entre produtos ainda não existe (hoje a foto é enviada por produto).

---

## 2. PESSOAS E EMPRESAS (cadastro único)

### Caminho
Cadastro → **Pessoas** → `/admin/cadastros/pessoas` · Botão **Novo cadastro**
Ficha completa: `/admin/cadastros/pessoas/{id}`

### Etapa 1 — Novo cadastro (uma tela)
Identificação: Nome completo (ou Razão social), Nome social (ou Fantasia), CPF/CNPJ, RG,
Data de nascimento, Profissão.
Contato: WhatsApp, E-mail.
Endereço principal: CEP, Rua, Número, Bairro, Cidade, Estado.
Observações.

Só o nome é obrigatório. Nada é gravado antes de clicar em **Criar cadastro**.

### Etapa 2 — Ficha completa (10 abas)

| Aba | O que tem | Para que serve |
| --- | --- | --- |
| Resumo | Percentual de completude e **papéis** da pessoa | Uma pessoa acumula papéis sem virar cadastro repetido |
| Identificação | Nome, nome social, CPF/CNPJ, situação do cadastro, RG/CNH, órgão emissor, nascimento, profissão, estado civil, ativo, observações | Base de identidade |
| Contatos | WhatsApp, telefone, e-mail (vários) | Contato e busca |
| Endereços | CEP, rua, número, bairro, cidade, UF | Entrega, região e mapa da rede |
| Dados comerciais | Data de entrada, origem, região, carteira, nível, ciclo, perfil de venda, experiência, público, disponibilidade, motivo de bloqueio | Ficha da consultora |
| Financeiro / PIX | Tipo de chave, chave PIX, titular, documento do titular, conta bancária, situação financeira, observações restritas | Acertos futuros. **Só Master, Diretoria e Financeiro veem** |
| Vínculos | Onde este cadastro é usado (fornecedor, entidade, usuário, candidatura…) | Evita cadastro duplicado |
| Estoque e maletas | Em implantação | Peças sob custódia |
| Acesso | Login vinculado | Quem entra no sistema |
| Histórico | Auditoria completa | Quem mudou o quê e quando |

**Papéis disponíveis:** candidata, consultora, revendedora, representante, colaborador, cliente,
fornecedor, entidade do grupo, transportadora, prestador, custodiante, usuária do sistema.
**Situações:** rascunho, em análise, aprovado, ativo, bloqueado, inativo, desligado.

### Regras já ativas
- CPF/CNPJ com máscara e validação matemática; o sistema avisa se já existe outro cadastro igual.
- Documento aparece **mascarado**; o número completo só com permissão e cada visualização fica registrada.
- Pessoa com histórico não é excluída: é inativada.
- Duplicidades ficam em Cadastro → `/admin/cadastros/duplicidades`.

### Pontos para o Daniel decidir
Falta algum campo de consultora (tamanho de maleta, meta, indicação/madrinha, contrato assinado)?

---

## 3. CANDIDATURAS (Seja LARDAN)

**Caminho:** `/admin/leads`
Vem do formulário público: nome, WhatsApp, endereço, cidade/UF, CEP, objetivo financeiro,
disponibilidade, experiência, público, motivação, origem/campanha, protocolo e consentimentos.
**Alimenta:** funil de recrutamento e o botão **Converter em consultora**, que cria a pessoa
na base única preservando protocolo e origem — sem criar login automaticamente.

---

## 4. FORNECEDORES

**Caminho:** Cadastro → **Fornecedores** → `/admin/cadastros/fornecedores`
Campos: CNPJ/CPF (com lupa que consulta a base pública e preenche sozinho), Razão social,
Nome fantasia, Pessoa de contato, E-mail, Telefone, Cidade, UF, Ativo, Observações.
**Alimenta:** ficha do produto, custo por variante e futuras compras.

## 5. ENTIDADES DO GRUPO

**Caminho:** Cadastro → **Entidades** → `/admin/cadastros/entidades`
Campos: CNPJ, Razão social, Nome fantasia, Inscrição estadual, Cidade, UF, Ativo, Observações.
**Alimenta:** a quem pertencem os locais de estoque e, no futuro, o financeiro.

## 6. CATEGORIAS e 7. COLEÇÕES

**Caminhos:** `/admin/cadastros/categorias` e `/admin/cadastros/colecoes`
Campos: Nome, Endereço (slug), Ordem, Descrição, Título para buscadores, Descrição para buscadores, Situação.
**Alimenta:** menu e páginas do site, filtros e organização do catálogo.
**Regra:** publicar é feito em **Site › Categorias e coleções**, que confere descrição, título,
texto para buscadores e imagem de capa antes de liberar a página.

## 8. LOCAIS FÍSICOS

**Caminho:** `/admin/cadastros/locais`
Campos: Código, Nome do local, Tipo (depósito, loja, maleta, trânsito, outro),
Entidade de negócio, Responsável, Endereço, Cidade, UF, Ativo, Observações.
**Alimenta:** todo saldo e toda movimentação de estoque, e as reservas.

## 9. USUÁRIOS E ACESSOS

**Caminho:** `/admin/usuarios`
Login, pessoa vinculada, papel (Master, Diretoria, Financeiro, Marketing, Suporte, Estoque,
Cobrança, Consultora, Representante) e ativo/inativo.
**Alimenta:** o que cada um enxerga. Documento completo, PIX e custo só para Master,
Diretoria e Financeiro.

## 10. ESTOQUE (entrada de dados, não é cadastro-base)

**Caminho:** `/admin/estoque`
Movimentações (entrada, saída, ajuste, transferência) com variante, local, quantidade,
motivo, referência e observação; e reservas com validade.
**Alimenta:** saldo por local, disponibilidade no site e histórico auditado.

---

## Resumo do caminho de cada cadastro

| Cadastro | Caminho | Alimenta |
| --- | --- | --- |
| Produto | Cadastro › Produtos | Site, sacola, estoque, reservas, custos |
| Variante / SKU | Dentro da ficha do produto | Estoque, venda, código de barras |
| Pessoa / empresa | Cadastro › Pessoas | Consultoras, clientes, acessos, rede |
| Candidatura | Leads | Recrutamento → consultora |
| Fornecedor | Cadastro › Fornecedores | Produto, custo, compras |
| Entidade do grupo | Cadastro › Entidades | Locais, financeiro |
| Categoria | Cadastro › Categorias | Site |
| Coleção | Cadastro › Coleções | Site |
| Local físico | Cadastro › Locais | Estoque e reservas |
| Usuário | Usuários | Permissões |

## Ainda em implantação (aparecem marcados no sistema, sem botão que finge funcionar)

Revendedoras · Representantes · Clientes · Prestadores · Transportadoras · Lojas ·
Biblioteca de imagens · Tabelas de preço · Maletas · Regiões e carteiras ·
Motivos de movimentação · Códigos de barras · Contas e caixas · Plano de contas ·
Centros de custo · Formas de pagamento · Contrapartes.

---

## Folha de validação

| Cadastro | OK? | Campo que falta | Campo que sobra | Observação |
| --- | --- | --- | --- | --- |
| Produto |  |  |  |  |
| Variante / SKU |  |  |  |  |
| Imagens do produto |  |  |  |  |
| Pessoa / consultora |  |  |  |  |
| Candidatura |  |  |  |  |
| Fornecedor |  |  |  |  |
| Entidade do grupo |  |  |  |  |
| Categoria |  |  |  |  |
| Coleção |  |  |  |  |
| Local físico |  |  |  |  |
| Usuário e permissões |  |  |  |  |
| Estoque |  |  |  |  |
