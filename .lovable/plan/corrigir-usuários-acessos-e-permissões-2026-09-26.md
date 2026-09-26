# Corrigir usuários, acessos e permissões

## Resultado esperado
- Remover definitivamente as contas de homologação da base real, sem tocar em colaboradores reais.
- Transformar a edição de acesso em uma seleção clara de várias áreas por colaborador.
- Mostrar, por pessoa, exatamente quais áreas do sistema cada papel libera.
- Garantir que conta inativa ou sem permissão não consiga abrir nem operar áreas restritas.

## Implementação
1. Auditar a matriz atual entre papéis, áreas e permissões e corrigir divergências.
2. Substituir o seletor de “um papel por vez” por edição explícita com múltipla seleção e salvamento conjunto.
3. Manter papéis na tabela separada de segurança e executar mudanças por operações autorizadas e auditadas.
4. Excluir somente perfis e contas de teste identificados por `@lardan.test` / `HOMOLOG`, preservando dados reais.
5. Melhorar a lista com situação, áreas liberadas e ação de editar, sem controles nativos.

## Validação e provas
- Abrir a tela publicada em sessão Master e clicar no fluxo completo de edição.
- Conceder duas áreas a uma conta controlada, recarregar e confirmar persistência.
- Entrar nessa conta e abrir as duas áreas permitidas.
- Tentar uma área não permitida e confirmar o bloqueio.
- Desativar a conta e confirmar bloqueio imediato; depois restaurar o estado de teste.
- Registrar capturas das etapas e conferir a auditoria gerada.

## Limites
- Nenhum convite real será enviado.
- Nenhum dado comercial, catálogo, estoque ou financeiro será alterado.
- Só publicar após a validação ficar limpa.
