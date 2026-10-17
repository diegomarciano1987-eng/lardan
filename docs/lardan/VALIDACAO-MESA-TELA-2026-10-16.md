# Mesa de conciliação — validação na tela

## Escopo
Validação autenticada como Master na prévia, em `/admin/financeiro/conciliacao`, com registros existentes. Nenhuma conciliação, baixa, cancelamento, edição financeira ou importação foi confirmada. Não houve publicação nem alteração do código da aplicação.

## Resultado observado
- Mesa Itaú, outubro de 2026: fila vazia, mensagem de ausência de pendências correta.
- Mesa ASAAS BOLETOS, outubro: uma linha real pendente de 09/10, saída de R$ 19.000,00. A validação prosseguiu nessa fila real.
- Sugestão existente “LIMPEZA ESCRITORIO E CASA”, R$ 250,00: selecionada apenas na bandeja local, sem confirmar vínculo. A classificação exibida foi `5.4.5 · Outras Despesas com Serviços de Terceiros`; centro de custo honestamente pendente.
- Diferença de R$ 18.750,00 exibida e botão Conciliar desabilitado, evitando confirmar seleção incompleta. A sugestão não foi tratada como correspondência válida da saída de R$ 19.000,00.
- “Procurar outra conta”: busca LIMPEZA retornou quatro parcelas reais de R$ 250,00, vencimentos 09, 12, 19 e 26/10.
- Teclas `2`, `1`, `P` e `Ctrl+Enter` com foco no campo: não trocaram o modo, não pularam a linha e não chamaram conciliação.
- Modo “Não, é novo”: campos de contraparte, centro de custo, conta contábil e forma de pagamento disponíveis; nenhuma criação confirmada.
- Teclas `1` e `2` com seletor aberto: preservaram o modo novo.
- “Baixas já realizadas”: campo de busca disponível e usado com ALUGUEL; nenhuma ligação a baixa confirmada.
- Fechar Mesa: retornou ao extrato corretamente.
- Navegador: zero erros de execução observados; sem transbordamento horizontal em 1156×702, o tamanho da janela informado pelo usuário. Capturas também realizadas em 1280×1800.
- Nenhuma chamada RPC de conciliação, marcação, criação de título ou edição financeira foi observada. `ensure_profile` foi chamado pelo acesso normal do aplicativo; não afirmar que todo o acesso fez exclusivamente SELECT.
- Contagem global de linhas pendentes/divergentes permaneceu 848 na conta ASAAS BOLETOS, antes e depois.

## Evidências
Script: `/tmp/browser/mesa-validacao/validar.py`.
Registro: `/tmp/browser/mesa-validacao/resultado.log`.
Capturas conferidas visualmente:
- `03-titulo-classificacao.png`: título existente e classificação lida.
- `04-busca-atalhos.png`: quatro resultados da busca com modo preservado.
- `04b-mesa-seu-tamanho.png`: janela 1156×702, sem sobreposição ou transbordamento horizontal.
Capturas adicionais: `02-mesa-itau.png`, `02-mesa-asaas.png`, `05-novo-sem-gravar.png`, `06-baixas.png`.

## Limite da conclusão
Busca, seleção local, leitura da classificação, proteção de atalhos e fechamento foram exercitados na tela com sessão e dados reais. A gravação efetiva de uma conciliação não foi testada contra dados reais, deliberadamente; portanto esta evidência não substitui os testes isolados da persistência financeira. Edição de parcela pertence a outro fluxo e não foi refeita nesta validação da Mesa.