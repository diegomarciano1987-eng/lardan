# Estúdio da Minha Vitrine

Complementa o plano da área comercial e toma o lugar da "Etapa 3 — Vitrine pessoal". As regras de estoque, acesso, CRM e vendas continuam valendo. A personalização nunca cria peça, nunca muda preço e nunca mostra como disponível uma peça que não está.

## Como a consultora vai usar
Em "Minha área" entra uma nova aba, **Estúdio**:
- **No computador:** controles à esquerda e a vitrine ao vivo à direita, com botão para ver como fica no celular ou no computador.
- **No celular:** dois botões no topo, "Editar" e "Visualizar".
- **Seis seções:** Meu perfil · Foto e capa · Aparência · Organização da vitrine · Contato e atendimento · Compartilhamento.
- **Salvamento:** tudo é salvo sozinho como rascunho, com aviso de "Salvando", "Salvo" ou "Falhou". Visitantes só veem mudanças depois de "Publicar alterações". Existem também "Descartar alterações", a comparação entre a versão no ar e o rascunho e o histórico de versões com restauração.

## Etapas
1. **Base (primeiro):** rascunho e versão publicada guardados separadamente no banco. Publicar troca a página inteira de uma vez, então ninguém vê metade das mudanças. Histórico de versões e restauração só do visual: estoque e preço continuam sempre atuais. Seções Meu perfil e Contato (nome público, frase, biografia com contador, cidade e região, horários, WhatsApp, Instagram/Facebook/TikTok, mensagem inicial), com exemplos editáveis.
2. **Foto e capa:** foto pela câmera ou galeria, com recorte, zoom, rotação, guia de rosto e aviso de baixa resolução. O original é guardado para reenquadrar depois. Vão para o ar só tamanhos leves e nítidos, sem metadados e sem filtros. Capa oficial Lardan ou própria, com ponto focal e prévia separada para celular e computador. Visual elegante para quem ainda não tem foto.
3. **Aparência:** três temas que mudam a composição de verdade:
   - **Clássica:** retrato sobre a capa e grade limpa.
   - **Editorial:** fotos grandes e perfil lateral no computador.
   - **Minimalista:** perfil centralizado e muito espaço.
   Dentro de cada tema há paletas, fontes, estilo de cartão e disposição do catálogo, todos aprovados, com miniaturas reais. Não existe cor ou fonte livre.
4. **Organização:** peças em destaque; ordem arrastando ou por botões de subir e descer; seleções ("Meus favoritos", "Para presentear", "Escolhas da semana"); quais seções aparecem e em que ordem; ocultar uma peça sem mexer no saldo; escolher a foto principal entre as fotos aprovadas da peça; prévia de como fica uma seleção vazia.
5. **Compartilhamento:** título, descrição e imagem de apresentação geradas por um modelo Lardan com a foto e o nome da consultora. Endereço público, QR Code para baixar, "Copiar link" e compartilhar pelo celular. Aviso de que WhatsApp e redes podem demorar para atualizar a prévia do link.
6. **Página pública e testes:** a vitrine pública passa a mostrar a versão publicada, com tema, capa, retrato, seções e o botão de WhatsApp da consultora. Testes com fotos em pé, deitadas, pequenas e muito grandes, nomes longos, biografia vazia, falha de envio, edição em duas abas, publicação repetida e restauração.

## O que fica garantido
- Dados privados do cadastro (documento, endereço, e-mail) nunca vão para a vitrine sozinhos. Só aparece o que ela preencher no Estúdio, marcado como "público".
- Nada inventado: sem depoimentos, certificados, número de clientes ou selos.
- Cada alteração é validada no servidor; esconder um botão não é a única proteção.

## Detalhes técnicos
- Tabelas novas: `showcase_designs` (draft jsonb, published jsonb, revision, published_at) e `showcase_design_versions` (histórico imutável). As funções `showcase_design_save` (com revisão otimista para a edição em duas abas), `showcase_design_publish`, `_discard` e `_restore` são SECURITY DEFINER e só a dona pode usar. Tudo validado por um esquema fixo de temas, paletas e fontes.
- O `showcase_public` passa a ler apenas `published`. As peças continuam vindo da regra de elegibilidade atual; curadoria só filtra e ordena ids já elegíveis.
- Armazenamento: o bucket privado `vitrine-originais` guarda originais e rascunhos, com acesso só da dona. O bucket público `vitrine-publica` guarda apenas os arquivos publicados. A imagem é processada no navegador (canvas, removendo EXIF) em tamanhos 400/800/1600 em WebP.
- Imagem de compartilhamento gerada por rota do servidor a partir da versão publicada. QR Code gerado no navegador.
- As regras de arquitetura ficam registradas em `AGENTS.md`.
