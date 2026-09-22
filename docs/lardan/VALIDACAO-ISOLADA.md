# Validação em ambiente isolado — maletas, fiscal e Asaas

Rodada de **comprovação**, não de implementação. Objetivo: executar em banco
isolado os testes que faltavam da rodada anterior.

Nenhuma escrita foi feita na base compartilhada por estes testes. Nenhum dado
pessoal, segredo ou credencial de produção foi copiado. Nada foi publicado,
nenhuma integração foi ligada e nenhum documento fiscal foi emitido.

## 1. Ambiente

Postgres local criado do zero, com dados exclusivamente sintéticos.
Reprodução em duas linhas (detalhes em `tests/isolado/LEIA-ME.md`):

```bash
bash tests/isolado/subir.sh
bun test tests/isolado
```

163 migrações aplicadas na ordem. Duas migrações ficam de fora por serem apenas
conteúdo do catálogo apontando para mídias da base compartilhada
(`tests/isolado/pular.txt`); não criam nem alteram estrutura.

Diferença consciente em relação à nuvem: o prelúdio concede a execução padrão de
rotinas do schema público, como a nuvem faz. Permissões de tabela continuam
tendo de vir de cada migração, para que a falta de uma apareça no teste.

## 2. Resultado

**41 testes, 41 aprovados.** Verificação de tipos limpa.

### Integridade das movimentações (28 testes)

| Cobrança pedida | Resultado |
| --- | --- |
| cenário 50 + 5 − 20 | 35 continuam sob responsabilidade, sem venda e sem dívida; nenhum título financeiro nasce da diferença |
| acesso cruzado por chave de repetição | consultora alheia não obtém o movimento de outra maleta |
| mesma chave com maleta, origem ou itens diferentes | recusada em todos os casos |
| repetição simultânea da mesma operação | um único efeito |
| duas operações disputando o mesmo estoque | nenhum saldo negativo |
| retorno de 20 com recebimento de 18 | 18 entram no depósito; as 2 seguem a explicar |
| confirmação repetida ou simultânea | não duplica estoque |
| garantia e defeito | vão para o local bloqueado, fora do estoque disponível, e não abastecem maleta nenhuma |
| liberação da garantia | só com permissão específica, com motivo e registro de auditoria |
| representante | restrito às suas maletas e aos depósitos pelos quais responde |
| recebimento por representante × consultora | quem está com a maleta é quem confirma; o recebimento do representante não cria aceite da consultora |
| usuário desativado, visitante, usuário sem pessoa vinculada | recusados |
| chamada direta fora da interface | não escreve movimentação, saldo nem estoque |
| falha no meio da operação | não deixa nada pela metade; saldo físico bate com o histórico |

### Fiscal e Asaas inertes, financeiro reaproveitado (13 testes)

| Cobrança pedida | Resultado |
| --- | --- |
| emissão fiscal | nasce desligada, sem provedor, emissor nem ambiente |
| documento fiscal | não sai da preparação com a emissão desligada; autorizado não volta atrás, só é cancelado |
| devolução simbólica | não movimenta estoque físico |
| documento fiscal | não gera título, parcela nem liquidação |
| chamada externa | não há caminho: sem extensão de rede, sem agendador e sem endereço em nenhuma rotina |
| conta Asaas | nenhuma nasce ativa; nada é importado sozinho |
| cobrança | só é marcada vinculada com título ou parcela; sozinha não cria lançamento |
| importação repetida três vezes | uma cobrança, um título, uma parcela, uma liquidação |
| evento repetido do provedor | entra uma vez na fila e não é processado sozinho |
| cobrança antiga | continua pendente; não existe vínculo automático com maleta |
| cliente Asaas | não é unido a pessoa por nome |

### Reaproveitamento do financeiro (estruturas existentes)

Recebíveis do Asaas entram no motor que já existe, sem estrutura paralela:

- obrigação → `financial_titles` (`sistema_origem='asaas'`, `id_externo`);
- vencimentos → `financial_installments`;
- pagamento → `financial_settlements` (`idempotency_key`);
- rateio → `financial_allocations`; estorno → o próprio estorno do motor.

A não duplicação não depende da rotina de importação: é do banco — chave única
por conta + identificador externo na cobrança, por origem + identificador
externo no título e por chave de idempotência na liquidação. O teste 10 executa
a mesma importação três vezes e confere as quatro contagens.

## 3. Falha encontrada e corrigida

**Quem podia liberar peças bloqueadas não conseguia liberar.** A liberação
exigia, além da permissão própria, a permissão geral de movimentar estoque, que
Qualidade não tem — então a garantia entrava no local bloqueado e não saía mais
por caminho autorizado. Corrigido no banco: a liberação passou a ser reconhecida
como operação interna da rotina oficial, que continua exigindo permissão
específica, motivo escrito, destino não bloqueado e registro de auditoria. Para
quem chama a rotina de estoque diretamente, nada mudou: sem permissão, recusado.

A correção está **aplicada ao banco compartilhado** e coberta pelo teste 19.

## 4. O que ficou fora

- **Base compartilhada:** por decisão desta rodada, nenhuma suíte de escrita foi
  executada lá. A comprovação vale para o mesmo conjunto de migrações aplicado
  no banco isolado.
- **Telas:** as verificações foram feitas no banco, chamando as rotinas no papel
  de Matriz, representante e consultora — que é onde as restrições vivem. As
  telas usam exatamente essas rotinas, mas não foram exercitadas com navegador
  nesta rodada.
- **Site publicado:** continua com a interface anterior, que não conhece as
  telas de histórico, acréscimo, retorno e conferência. Ela não quebra — as
  rotinas antigas mantêm assinatura e comportamento —, mas as operações novas só
  aparecem depois da publicação, que não foi feita.
- **Pendências de negócio inalteradas:** a regra do acerto continua indefinida; a
  proporção de "um terço" continua registrada como pendente, sem percentual e
  sem efeito; as vendas da consultora ainda não alimentam a conciliação. O
  sistema **não** está fiscalmente pronto.
