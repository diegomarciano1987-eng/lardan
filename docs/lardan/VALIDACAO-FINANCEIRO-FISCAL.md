# Validação isolada — acerto, Asaas e cadeia fiscal

Data: 23/09/2026. Ambiente: Postgres local e descartável (porta 55432), criado
por `tests/isolado/subir.sh` a partir das migrações oficiais mais os arquivos
preparados em `db/pendentes/`. Dados exclusivamente sintéticos. **Nada foi
aplicado ao banco compartilhado, nada foi publicado, nenhuma credencial foi
usada e nenhuma chamada externa foi feita.**

Reprodução integral:

```
bash tests/isolado/subir.sh && bun test tests/isolado
```

Resultado desta rodada: **79 provas aprovadas, 0 falhas, 222 verificações**,
em cinco baterias:

| Bateria | Provas | Assunto |
| --- | --- | --- |
| `maletas.test.ts` | 29 | operação de maletas já validada antes |
| `fiscal-asaas.test.ts` | 12 | fiscal e Asaas continuam inertes |
| `acerto.test.ts` | 14 | evidência de venda e acerto comercial |
| `asaas-endurecido.test.ts` | 14 | contas, cobranças, eventos e vínculos |
| `fiscal-cadeia.test.ts` | 10 | preparação, pendências, fila e histórico |

## O que ficou comprovado

- Acerto é conferência física: não cria título, parcela, liquidação, nota nem
  cobrança, e **não pode ser aprovado** enquanto a regra comercial não existir.
- Evidência de venda pela vitrine exige item de pedido real; repetir a mesma
  chave não duplica; correção é compensação, não apagamento do passado.
- Cobrança do Asaas não vira "vinculada" fora da rotina oficial, nem sem
  permissão, nem sem título a receber compatível; repetir a importação não
  duplica título, parcela nem liquidação; evento repetido entra uma só vez.
- Conta de produção do Asaas não pode ser ativada nesta preparação; nenhum
  segredo é guardado no banco — apenas a referência ao nome do segredo.
- Documento fiscal nasce em preparação, lista as pendências em aberto e não
  entra em fila nem é autorizado: autorização exige retorno de provedor
  registrado pela rotina oficial, e não existe provedor escolhido.
- Nenhuma rotina do banco conhece endereço de provedor; não há extensão de
  rede nem agendador instalado.

## Correções feitas durante a validação

- A trava fiscal antiga só conhecia a situação "preparação" e barrava as novas
  situações de preparação (rascunho, bloqueado por pendência, validado).
- A coerência de recebido, líquido e tarifa passou a exigir igualdade exata.
- Registro de auditoria usava um nome de coluna inexistente.
- Comparações de chave interna retornavam indefinido quando a chave não estava
  ligada, o que deixava passar escrita fora da rotina oficial. Corrigido nos
  três arquivos preparados.

## Limites desta rodada

- Tudo em `db/pendentes/` está **preparado e validado em ambiente isolado**;
  **nada foi aplicado ao banco compartilhado**.
- Continua pendente de decisão comercial: valor devido por peça, significado
  do valor intermediário, quem é o comprador, momento da dívida, perdas,
  garantias, divergências, cancelamento após acerto e pagamentos parciais.
- Continua pendente de contador e de escolha de provedor: natureza da
  operação, CFOP, regime e valor fiscal. A proporção de "um terço" permanece
  registrada como pendência, sem efeito.
