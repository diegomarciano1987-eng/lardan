# App da consultora — provas de 28/10/2026

## Entregue
- Seleção visual da aba no clique, sincronizada com endereço e histórico.
- Cache compartilhado de leituras por 60 segundos; mutações oficiais continuam invalidando os dados.
- Pré-carregamento seletivo de clientes, pedidos e ganhos; busca de clientes com espera de 250 ms e resumo indexado por cliente.
- Liga compacta e colapsável no topo do Início, em celular e desktop.
- Barra financeira de zero ao total de tabela da remessa; vendas pagas, faixa e comissão estimada vêm da rotina oficial `consultora_ganhos`.
- Atalhos Meu financeiro, Jornada e Liga também em Mais e no menu completo.

## Segurança preservada
Primeira verificação de aceite continua bloqueante, inclusive se falhar. Só uma resposta vazia bem-sucedida libera. Falha em atualização não apaga a última conferência bem-sucedida; aviso e tentativa manual ficam visíveis. Pendência confirmada segue bloqueando e assinatura externa não foi removida. Sem alterações de preços, estoque, papéis ou permissões.

## Provas executadas
- `bunx vitest run tests/consultora`: 23 testes passaram.
- `bun test tests/isolado/app-consultora.test.ts tests/isolado/aceite-pedido-personalizado.test.ts`: 19 testes passaram, 106 verificações.
- Playwright autenticado como Diego Silva: 375×667, 412×915 e 1280×1800. 24 cliques principais, todos abriram o título esperado; tempos observados 66–136 ms (mediana 95 ms), com atraso artificial de 550 ms na verificação de usuário. Mede título/seleção, não o carregamento integral de cada consulta.
- Sete destinos adicionais de Mais verificados em cada celular; Liga expandiu/recolheu; modos claro/escuro inspecionados, sem transbordamento horizontal ou erros JavaScript.
- Quinze toques seguidos: última aba e endereço concordam. Resposta 503 controlada na atualização do aceite: navegação permanece funcional e aviso aparece.
- Barra na cópia isolada com sessão autenticada: R$150 vendidos, total R$500, comissão R$30, faixa 20%; leitura pela tela e atributos da barra conferidos. Dados exclusivamente de teste, sem escrita na operação.
- Último registro de compilação: build OK.

## Limites
Diego Silva não possui maleta em operação na base real; por isso a barra não aparece nessa conta até existir uma remessa elegível. Não foi criada uma maleta artificial na operação. Sem teste de mil acessos simultâneos, sem promessa de desempenho no aparelho da gravação ou de latência zero. Publicação ainda necessária para www.lardan.com.br.

Evidências locais desta execução: `/tmp/browser/consultora-velocidade/` (capturas dark/light, resultados de cliques, barra isolada e falha de rede). Scripts usados nessa pasta podem ser repetidos enquanto as sessões de teste estiverem válidas.