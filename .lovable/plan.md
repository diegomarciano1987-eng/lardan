# Fechamento da demonstração Asaas (isolado) + dados fiscais preparatórios

Escopo mantido: nada aplicado ao banco compartilhado, nada publicado, nenhuma conexão externa, nenhuma credencial, nenhum envio.

## 1. Segunda instância isolada (porta 8090)
- Pilha local completa, só com dados sintéticos:
  - Postgres isolado já existente (porta 55432) com migrações oficiais + `db/pendentes/*.sql`.
  - PostgREST local (API de dados) apontando para o isolado, com os papéis `anon`/`authenticated`/`service_role` e o mesmo segredo JWT local.
  - Serviço de autenticação local (GoTrue) ligado ao mesmo Postgres; se o binário não estiver disponível, emissão de sessões JWT locais assinadas com o segredo do isolado para usuários sintéticos já criados em `auth.users` (registrado como limitação, com comando e erro).
  - Gateway mínimo (proxy local) expondo `/rest/v1` e `/auth/v1` no formato que o cliente espera.
- Segunda instância do Vite em `:8090` com `VITE_SUPABASE_URL`/chaves locais via variáveis de ambiente do processo, `ASAAS_AMBIENTE=simulacao`. A pré-visualização em `:8080` não é tocada.
- Script reproduzível: `tests/isolado/subir-app.sh` (sobe/derruba API, auth, proxy e Vite isolado).

## 2. Exercício pelo navegador (Playwright contra :8090)
Roteiro com capturas em computador (1280) e celular (390):
prévia com >100 cobranças · resolução de cliente/duplicidade · aprovação por usuário autorizado · efetivação sem duplicar · abertura de parcela · preparação de cobrança · fatura simulada · reaproveitamento · duplo clique · resposta perdida e recuperação · evento simulado e efeito no financeiro · recusa para perfil sem permissão.
- Onde a tela atual não oferece a ação (ex.: prévia/aprovação só descritas hoje), completar a tela `AsaasReceber` com os controles mínimos que chamam as rotinas já existentes — sem regra nova.

## 3. Matriz de efeitos financeiros
Por cenário (integral, parcial, juros/multa/desconto, tarifa, fora do Asaas, estorno parcial/integral, chargeback, importação histórica, saldo inicial): espelho Asaas · título/parcela · liquidação/alocação · razão · pendente de decisão (com a pergunta exata).
- Prova isolada nova mostrando saldos antes/depois de parcela e conta financeira. Onde houver liquidação, ela só ocorre por ação explícita via `fin_settlement_create`; evento sozinho nunca liquida.
- Prova de que a pendência contábil não bloqueia preparar cobrança de título manual aprovado.

## 4. Dados fiscais (documento próprio, sem alterar cadastros)
- `docs/lardan/FISCAL-DADOS-EMPRESA.md`: dados informados pelo cliente vs demonstrados pelo Credenciamento.pdf (JFLEX, código 77066, NF-e 55 / NFC-e 65, Autorizado/Credenciado) — autorização do JFLEX não se estende ao novo sistema.
- Consulta somente leitura em `business_entities` pelo CNPJ 43.319.208/0001-80: proposta de vínculo/atualização e conflitos encontrados (sem gravar).
- `db/pendentes/06-fiscal-emitente-proposta.sql` (não aplicado): estrutura de configuração do emitente vinculada à entidade existente, emissão desligada, sem tributos.
- Lista de pendências da futura emissão (as 9 informadas).

## 5. Entrega
- Atualizar `ASAAS-RECEBIVEIS.md`: evidências do navegador, matriz, cenários completos/bloqueados, commit exato testado, testes e limitações.
- Rodar `bash tests/isolado/subir.sh && bun test tests/isolado` e registrar números reais.
- ZIP em Files com serviços, adaptadores, telas, testes, `db/pendentes/`, docs e manifesto SHA-256.

## Riscos
- Autenticação local: se nenhum servidor de auth puder rodar no sandbox, uso sessões locais assinadas e documento o impedimento com componente, comando e erro.
