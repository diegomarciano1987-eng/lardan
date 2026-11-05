# Correios — etapa 1 (0228)

Conferido em 05/11/2026. Sem publicação, alteração de estoque, lançamento financeiro ou postagem.

## Aplicação
- Transporte exclusivo do servidor, funções autenticadas e permissão Master verificada por fiscal_focus_pode('emitir'), cuja implementação restringe a Master.
- Painel em Administração → Integrações. Nenhum serviço de pré-postagem adicionado.
- Configuração fornecida no pacote salva em segredos; código de acesso existente preservado; ambiente homologação conforme as instruções do pacote.
- Ajustes de segurança: timeout na autenticação, ausência de corpos de erro e tokens no diagnóstico, cache vinculado à configuração e resultado negativo quando consultas falham. Códigos de serviço não são presumidos como contratados.

## Provas
- `bunx vitest run tests/integracoes/correios-transporte.test.ts`: 7 testes aprovados, com rede simulada e sem banco real.
- Compilação automática: build OK, 20:32:26 UTC.
- Navegação autenticada como Diego para `/admin/integracoes`; clique real em **Testar conexão**, CEP de destino 15520011.
- Resultado visível: **Falhou em: token**; **Autenticação recusada pelos Correios (401)**; ambiente homologação; faltando = []. O botão voltou a ficar disponível.
- Captura do painel inspecionada em `/tmp/browser/correios/painel.png` (arquivo temporário).

## Limites
O erro 401 não prova que o código de acesso é inválido: pode envolver credencial, contrato ou ambiente. Não houve autenticação aceita, portanto preço, prazo, serviços e rastreio não foram comprovados. Nenhuma cobrança ou envio realizado. As etapas futuras do plano de maletas e garantias não foram implementadas.