# Homologação da Vitrine — evidências reais

Data: 2026-09-06 (UTC). Execução no navegador (Playwright, viewport 1280x1800) contra
`http://localhost:8080`, com sessão real de administrador e uma segunda janela anônima
para o público.

## Registro usado

- Categoria: **HOMOLOG Teste Aneis** (`/semijoias/homolog-teste-aneis`)
- Produto: **HOMOLOG Anel Teste** — `id 1131ee25-a04b-4d71-9625-0df71c9ca43e`
- URL pública: `http://localhost:8080/produto/homolog-anel-teste`
- Variante: `Único` — SKU `HOM-0001`, EAN `7890000000017`, preço R$ 189,90 (depois R$ 219,90)
- 3 imagens enviadas (`catalogo/…jpg`), com texto alternativo e reordenação

## Resultado dos testes

| # | Teste | Resultado |
|---|---|---|
| 1 | Criar categoria pelo painel | OK |
| 2 | Salvar e recarregar (persistência) | OK |
| 3 | Publicar a categoria | OK |
| 4 | Cadastrar produto | OK |
| 5 | Cadastrar variante | OK |
| 6 | Informar SKU | OK |
| 7 | Informar código de barras | OK |
| 8 | Definir preço | OK |
| 9 | Ativar "Mostrar preço no site" | OK |
| 10 | Material | OK |
| 11 | Medidas | OK |
| 12 | Cuidados | OK |
| 13 | Garantia | OK |
| 14 | Enviar 3 imagens | OK |
| 15 | Escolher imagem principal | OK (foto 3 passou para posição 0) |
| 16 | Reordenar imagens | OK (persistido em `product_media.position`) |
| 17 | Texto alternativo | OK (`media_assets.alt` gravado nas 3) |
| 18 | Publicar o produto | OK |
| 19 | Botão "Ver no site" | OK (aparece só quando publicado) |
| 20 | Busca pública | OK |
| 21 | Página da categoria | OK |
| 22 | Página individual | OK |
| 23 | Fotos, preço e informações conferidos | OK (evidência: captura da página) |
| 24 | Alterar preço no admin | OK |
| 25 | Atualização pública do preço | OK (R$ 219,90) |
| 26 | Esconder o preço | OK |
| 27 | Produto continua publicado sem preço | OK |
| 28 | Despublicar | OK |
| 29 | Sai da busca e da categoria | OK |
| 30 | URL antiga | 404 correto (página em português) |
| 31 | Imagem privada após despublicar | HTTP 404 |
| 32 | Republicar | OK (produto e imagem 200 de volta) |

## Segurança das imagens

- O balde `media` é **privado**. Acesso direto a
  `/storage/v1/object/public/media/…` retorna **400** (bucket não é público).
- A entrega pública passa só por `GET /api/public/midia/:id`, executada no servidor.
  O handler:
  1. valida o formato do id (UUID) — id fora do padrão devolve 404;
  2. lê a mídia com credencial de serviço e recusa arquivo arquivado;
  3. exige vínculo em `product_media` com produto de status `publicado`;
  4. só então baixa do balde privado e devolve os bytes.
- Trocar o id na URL não ajuda: id inexistente → 404; id de mídia ligada a produto
  não publicado → 404 (testado logo após despublicar).
- Nenhum link assinado do balde é exposto ao público; o caminho interno
  (`catalogo/<uuid>.jpg`) nunca aparece no HTML — o cliente só vê `/api/public/midia/<uuid>`,
  e o nome do arquivo é um UUID, sem nome comercial, fornecedor ou custo.
- No painel, as miniaturas usam URL assinada com expiração curta, não o caminho bruto.

### Invalidação após despublicação

A autorização é verificada **a cada requisição** no servidor: despublicar o produto já
corta a entrega na origem. O cabeçalho de cache foi reduzido para
`public, max-age=60, s-maxage=60, stale-while-revalidate=120`, então a janela máxima em
que um cache de borda ou de navegador pode ainda servir a imagem é de 60 segundos
(antes eram 24h de borda — corrigido nesta homologação). Não há URL permanente
assinada para invalidar: basta mudar o status do produto.

## Limpeza

Os registros de homologação foram **arquivados logicamente** (produto e categoria com
status `arquivado`, mídias com `is_archived = true`). Nada foi apagado e a auditoria
(`audit_logs`) permanece íntegra.
