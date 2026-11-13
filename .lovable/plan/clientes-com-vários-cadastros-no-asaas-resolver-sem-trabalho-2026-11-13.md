# Clientes com vários cadastros no Asaas: resolver sem trabalho para a Larissa

## O que a leitura mostrou (13/11, só leitura)
- Os 83 cadastros pendentes pertencem a **apenas 19 clientes**, e não a 83 pessoas.
- **Nenhum cadastro está vazio.** Todos têm cobrança. Por isso não existe um cadastro "errado" para apagar.
- O motivo é que, em 09/10 e nos dias seguintes, o Asaas ganhou um cadastro novo para cada boleto de parcelamento. Exemplos:
  - Gabrielli de Assis Almeida (6954): 15 cadastros e 14 boletos em aberto, um em cada cadastro.
  - Geisimara Soares da Cruz (1555): 13 cadastros e 13 boletos.
  - Barbara Caroline Macedo Martineli (6469): 12 cadastros e 11 boletos.
- 14 das 19 clientes têm o mesmo celular em todos os cadastros. Em 5 o celular é diferente: Debora Lea Lopes, Ana Paula Prique Valdoski, Iris Adriele Acunha Cardoso, Jessica Cristine de Oliveira Quirino Pereira e Regiane Ferreira da Silva.
- O Asaas não deixa trocar o dono de um boleto. Juntar tudo num cadastro só exigiria cancelar e reemitir dezenas de boletos, com aviso novo chegando para a cliente. **Não vou fazer isso.**

## A solução: a Larissa não precisa fazer nada
1. **Mesmo CPF é a mesma pessoa.** Todos os cadastros do Asaas da cliente passam a ficar ligados a ela no Lardan. Nenhum fica "pendente".
2. **O Lardan escolhe sozinho um cadastro principal**, que recebe as cobranças novas e as reemissões pelo saldo. A escolha segue esta ordem: o cadastro mais recente que tem boleto em aberto e, se empatar, o criado por último. Cada escolha fica registrada com o motivo.
3. **O cadastro do Lardan vai para todos os cadastros dela no Asaas:** nome, celular, e-mail e endereço. Assim todo boleto avisa no WhatsApp certo, seja qual for o cadastro dele. Isso segue a regra de hoje em diante: só vale o Lardan.
   - Nas 5 clientes com celular diferente, vai o celular do Lardan. Antes de aplicar, eu mostro a você a lista com o celular de cada uma.
4. **A baixa parcial com reemissão volta a funcionar para essas 19.** Hoje a reemissão para quando a cliente tem dois cadastros, e a Larissa tem que gerar a nova cobrança na mão. Com o principal definido, a nova cobrança sai sozinha.
5. **Para não nascer duplicado de novo:** antes de criar um cliente no Asaas, o Lardan procura pelo CPF e aproveita o cadastro que já existe. Se aparecer um duplicado novo, criado direto no Asaas, a conferência diária liga esse cadastro à mesma pessoa sozinha.

## O que a Larissa vai ver
- No Espelho Asaas, um quadro **"Clientes com vários cadastros no Asaas"** que só informa. Ele mostra cada cliente, quantos cadastros ela tem, qual é o principal e se todos estão iguais ao Lardan.
- Um botão **"Trocar principal"** para casos raros, com motivo obrigatório e registro de quem trocou. Ela não precisa usá-lo no dia a dia.
- O aviso "Cliente com dois cadastros no Asaas" some das exceções.

## Etapas, com provas
1. **Prévia, só leitura:** uma planilha com as 19 clientes, o principal escolhido, os boletos em cada cadastro e o que vai ser enviado ao Asaas, campo a campo. Mando para você antes de mudar qualquer coisa.
2. **Piloto em uma cliente** (Gabrielli, 15 cadastros): ligar todos, enviar o cadastro e reler no Asaas que os 15 ficaram iguais ao Lardan.
3. **As outras 18 clientes:** no mesmo ritmo da fila de hoje, de 15 por minuto.
4. **Testes:** principal escolhido sozinho, envio para todos os cadastros, reemissão de saldo saindo no principal, duplicado novo ligado sozinho, nenhum boleto cancelado ou reemitido. Rodo a bateria isolada inteira.
5. **Relatório final** com os números: pendentes antes e depois, cadastros conferidos no Asaas e exceções que sobraram.

## O que fica igual
- Nenhum boleto é cancelado, reemitido ou muda de valor ou vencimento por causa disso.
- Nada que só existe no Asaas é apagado.
- Um CPF diferente nunca é trocado sozinho.
- Nenhum dinheiro é lançado.

## Detalhes técnicos
- Nova coluna `asaas_customers.principal boolean`, com índice único parcial por (account_id, party_id) onde principal. Todos os irmãos passam a `vinculado`. `asaas_clientes_cadastrar` deixa de marcar `pendente` por duplicidade e só define o principal quando ainda não existe um.
- Emissão e reemissão (`clienteReservar` / `asaas_saldo_plano`) usam o principal. O motivo `cliente_duplicado` só fica para o caso sem principal, que não deve acontecer.
- O espelho de cadastro (`asaas_cliente_espelho_*` e a conferência diária) passa a ir para cada `external_id` da pessoa, com uma linha de fila por cadastro e a idempotência de hoje.
- `prepararCliente` consulta `GET /customers?cpfCnpj=` antes de criar o cliente. Se houver mais de um, usa o principal.
- RPC `asaas_principal_trocar(_customer, _motivo)` para quem tem `finance.receivable.manage`, com registro no audit_logs. Quadro só de leitura no painel Espelho Asaas.
- Migração numerada depois da 0311 e registrada em `src/lib/asaas/AGENTS.md`, substituindo a regra 0310 de "duplicados ficam pendentes".
