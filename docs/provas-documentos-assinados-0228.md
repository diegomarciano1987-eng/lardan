# Documentos assinados — provas de 05/11/2026

## Entregue
- Aba Documentos assinados no cadastro, reunindo ZapSign e termos de maleta já existentes.
- Importação Master em produção com os segredos existentes; nenhuma emissão, envio para assinatura, cobrança ou alteração financeira.
- PDFs copiados para armazenamento privado, abertura autorizada com link de cinco minutos; cópias existentes independem da API da ZapSign.

## Provas
- 16 testes isolados passaram (7 documentos + 9 regressões de abertura/DANFE/ZapSign), com 91 verificações.
- 5 testes de transporte passaram: destinos permitidos, timeout, sem redirecionamento, PDF verdadeiro, limite de 20 MB e erros sem corpo do provedor.
- Banco compartilhado confirmado: armazenamento privado; quatro campos novos; 87 documentos ligados a 74 pessoas, 63 assinados e 63 cópias salvas.
- Importação completa autenticada como Diego: 209 lidos, 4 novos nesta última execução, 83 atualizados, 122 sem correspondência/revisão e zero falhas. Execuções anteriores também importaram parte do histórico; não duplicam tokens.
- Cadastro real Jhenifer Cristina da Rocha mostrou dois documentos assinados. Clique em Abrir assinado retornou PDF privado HTTP 200, cabeçalho `%PDF-`, 1.856.341 bytes. O visualizador abriu; a captura instantânea não comprova renderização das páginas internas.
- Prévia sem erros de compilação (último sinal: build OK).
- Capturas da sessão: `/tmp/browser/documentos/cadastro-assinado.png` e `/tmp/browser/documentos/importacao.png`.

## Ajustes em relação ao pacote
- Armazenamento criado pela API própria, em vez de INSERT no schema gerenciado.
- Carteira da colaboradora preservada também na autorização dos documentos.
- Ambiguidade de CPF/telefone interrompe o vínculo; múltiplos signatários ficam para revisão, sem escolher arbitrariamente um cadastro.
- Documentos avulsos pendentes não disputam a trava de contrato/promissória; esta continua única.
- Caminho da cópia validado pelo cadastro/token; não sobrescreve evidências.
- Download limitado e validado; erros do provedor não expõem corpo, links ou credenciais.
- Botões do padrão visual, estado de abertura e importação honesto; abertura não depende de popup após espera de rede.

## Limites
- 122 documentos não foram vinculados automaticamente; aparecem para conferência em Integrações. Não foi criada interface nova de vinculação manual.
- Novo aviso externo da ZapSign não foi disparado nesta execução; validação real foi pela importação. O endereço do aviso continua o existente.
- Não foram alterados segredos nem o ambiente de produção.
- Publicação solicitada separadamente após esta validação; o resultado do pedido não comprova que a versão já entrou no ar.