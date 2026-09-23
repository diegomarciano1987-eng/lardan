# Mudanças de banco preparadas e NÃO aplicadas ao banco compartilhado

Cada arquivo desta pasta é aditivo e idempotente. Eles são aplicados **somente**
no Postgres local isolado (`bash tests/isolado/subir.sh`, que roda as migrações
oficiais e depois esta pasta, em ordem de nome).

Nenhum arquivo daqui foi executado no banco compartilhado (pré-visualização e
site publicado). A promoção para migração oficial acontece em rodada própria,
com autorização explícita, sem editar o conteúdo já validado.

| Arquivo | Conteúdo |
| --- | --- |
| `01-precos-versionados.sql` | versionamento real de políticas e preços, snapshot de preço |
| `02-acerto-e-evidencia.sql` | domínio do acerto comercial e evidência de venda da consultora |
| `03-asaas-endurecido.sql` | contas, cobranças, clientes, eventos e importação do Asaas |
| `04-fiscal-cadeia.sql` | cadeia fiscal auditável, imutabilidade e rotinas oficiais |

- `07-asaas-executor-interno.sql` — executor interno (service_role) para resultado, cliente, link e eventos; posse temporária e retomada; conciliação bloqueando; link no espelho validado por modo/ambiente; modo de execução separado do ambiente; painel paginado por cursor. Pendente, validado só no banco isolado.
