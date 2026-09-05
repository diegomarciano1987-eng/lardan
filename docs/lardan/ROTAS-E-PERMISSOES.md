# LARDAN — Rotas e Permissões

## Rotas reservadas (nunca disponíveis como slug de consultora)

`/admin`, `/sistema`, `/app`, `/representante`, `/loja`, `/acesso`

- `/loja` reservado ao PDV privado futuro. Catálogo público usa `/semijoias`.
- Minisite de consultora (futuro): preferir `/consultora/:slug`. URL curta `/:slug` só como alias validado, depois das rotas reservadas.

## Rotas públicas — site (V/5)

| ID | Rota | Estado |
| --- | --- | --- |
| WEB-01 | / | IMPLEMENTADO (Lote 1: hero, menu, primeira categoria) |
| WEB-02 | /semijoias | ESTRUTURADO (página-base no Lote 1; catálogo real no Lote 3) |
| WEB-03 | /novidades | DOCUMENTADO |
| WEB-04 | /mais-vendidos | DOCUMENTADO (estado vazio honesto sem dados) |
| WEB-05 | /colecoes + /colecoes/:slug | ESTRUTURADO (listagem-base no Lote 1) |
| WEB-06 | /semijoias/brincos | DOCUMENTADO (aguarda imagem lardan-categoria-brincos) |
| WEB-07 | /semijoias/colares | ESTRUTURADO |
| WEB-08 | /semijoias/pulseiras | DOCUMENTADO (aguarda imagem lardan-categoria-pulseiras) |
| WEB-09 | /semijoias/aneis | ESTRUTURADO |
| WEB-10 | /presentes | DOCUMENTADO |
| WEB-11 | /a-lardan | ESTRUTURADO |
| WEB-12 | /qualidade-e-garantia | DOCUMENTADO (garantia comercial de 2 anos conforme regras aprovadas) |
| WEB-13 | /encontre-uma-consultora | DOCUMENTADO |
| WEB-14 | /seja-lardan | ESTRUTURADO (formulário persistido no Lote 4) |
| WEB-15 | /conteudos + /conteudos/:slug | DOCUMENTADO |

Auxiliares: /contato (ESTRUTURADO), /produto/:slug, /privacidade, /termos, /acesso, /recuperar-acesso, 404 real.

### Captação (15 rotas sob /seja-lardan/) — V/5.1

CAP-01 como-vender-semijoias; CAP-02 como-ganhar-dinheiro-com-semijoias; CAP-03 renda-extra-com-semijoias; CAP-04 trabalhe-com-semijoias; CAP-05 seja-revendedora-de-semijoias; CAP-06 como-comecar-a-vender-joias; CAP-07 venda-semijoias-em-casa; CAP-08 trabalhe-no-seu-horario; CAP-09 renda-pelo-celular; CAP-10 consultora-lardan; CAP-11 vendedora-de-semijoias; CAP-12 oportunidade-de-renda; CAP-13 venda-semijoias-pelo-whatsapp; CAP-14 como-aumentar-sua-renda; CAP-15 quero-vender-lardan.
Estado: DOCUMENTADO. Conteúdo original por pauta; sem promessa de renda garantida. Rascunhos fora do sitemap até aprovação editorial.

## Rotas privadas — admin (V/6)

| ID | Rota | Estado |
| --- | --- | --- |
| ADM-01 | /acesso | ESTRUTURADO (tela; autenticação real no Lote 2, depende de backend) |
| ADM-02 | /admin | ESTRUTURADO (shell protegido, zeros reais; backend no Lote 2) |
| ADM-03 | /admin/site/paginas | DOCUMENTADO |
| ADM-04 | /admin/site/home | DOCUMENTADO |
| ADM-05 | /admin/produtos | DOCUMENTADO (editorial AGORA; custo/margem/fiscal posteriores e restritos) |
| ADM-06 | /admin/categorias | DOCUMENTADO |
| ADM-07 | /admin/colecoes | DOCUMENTADO |
| ADM-08 | /admin/conteudos | DOCUMENTADO |
| ADM-09 | /admin/midias | DOCUMENTADO |
| ADM-10 | /admin/leads | DOCUMENTADO |
| ADM-11 | /admin/mensagens | DOCUMENTADO |
| ADM-12 | /admin/consultoras-publicas | DOCUMENTADO |
| ADM-13 | /admin/configuracoes/site | DOCUMENTADO |
| ADM-14 | /admin/usuarios | DOCUMENTADO |
| ADM-15 | /admin/auditoria | DOCUMENTADO (logs imutáveis) |
| ADM-16 | /admin/roadmap | DOCUMENTADO (catálogo privado de módulos futuros) |

## Perfis e permissões (V/6, GOV-01)

Master, Diretoria, Financeiro, Cobrança, Estoque, Montagem, Qualidade, Representante, Consultora, Marketing, Suporte.
Regras: editor não se autopromove nem vê credenciais/custos/documentos; escopo por recurso e operação; sem "admin global" por conveniência; primeiro administrador por procedimento seguro documentado, sem senha padrão; proibida autoelevação por campo de formulário, metadata de cliente ou endpoint público.

## SEO/indexação

/admin, /sistema, /app, /loja, rascunhos e testes: sem indexação. robots/noindex não substitui autenticação. Sitemap somente com URLs públicas publicadas.
