# Fotos na vitrine e na maleta da consultora

## Causa confirmada
- As 13.104 fotos estão no sistema e ligadas às peças.
- Porém os 17.018 produtos importados estão como **rascunho**, não "publicado".
- O endereço que entrega as fotos ao público só libera foto de produto **publicado**. Por isso recusa todas: a vitrine da Larissa mostra o quadro vazio (com o nome da peça por cima) e "Minhas peças" mostra o ícone de sem foto.
- Na área da consultora, quando esse endereço recusa a foto, a tela não tenta outro caminho.

## Correção (sem publicar o catálogo inteiro na loja)
1. **Regra nova de liberação da foto:** a foto pode ser mostrada se a peça estiver publicada **ou** se estiver hoje na maleta de uma consultora ativa (com saldo disponível na vitrine). Assim nenhuma peça vira produto da loja pública sem querer, e as fotos de rascunho fora das maletas continuam privadas.
2. **Uma verificação só no banco**, rápida, em vez de três consultas, para a página abrir rápido mesmo com 50+ peças.
3. **Área da consultora (Minhas peças, pedidos, maleta):** se a foto pública falhar, a miniatura busca a foto pelo caminho interno seguro (já usado nas listas da gestão). Nunca fica vazia quando a peça tem foto.
4. **Vitrine pública:** sem foto, o cartão mostra o quadro elegante "Sem foto" — nunca o nome da peça "quebrado" por cima, como no primeiro print.
5. **Cache:** fotos liberadas ficam guardadas na borda por 1 hora; quando a peça sai da maleta, deixa de sair em até 5 minutos.

## Provas que vou entregar
- Contagem: peças da maleta da Larissa com foto x fotos que passam a abrir (alvo: 100% das que têm foto).
- Teste do endereço: foto de peça da maleta abre (200); foto de rascunho fora de qualquer maleta continua recusada (404).
- Abrir a vitrine /larissalardan e "Minhas peças" no navegador com captura de tela.
- Mesma checagem para todas as consultoras ativas (lista das que têm peças sem foto, para o Daniel saber).
- Testes automáticos da vitrine rodando.

## Atenção
- Para o site oficial mostrar, é preciso publicar depois.
- Peças sem foto cadastrada (cerca de 4 mil) continuam sem foto — não invento imagem.

## Detalhes técnicos
- Função `media_publica_ok(_media uuid)` SECURITY DEFINER, execução só service_role: true se `product_media` → produto publicado, hero de categoria/coleção publicada, ou `product_media` → variante em `kit_balances` com `qty_available > 0` num ciclo em operação de consultora ativa.
- `/api/public/midia/$id` passa a chamar essa função.
- `FotoPeca`: no `onError` da URL direta, cai para o lote assinado (`capasDasPecas`) via `variantId`/`productId`.
- Regra registrada em `src/components/vitrine/AGENTS.md`.
