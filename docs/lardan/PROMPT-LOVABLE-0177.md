# Para o Lovable — 0177: Financeiro da família no app da consultora e do representante

Aplique **depois da 0176**, exatamente como está. Não renomeie tabelas/funções e não publique sem a minha aprovação.

É o "Financeiro Família" do nosso sistema antigo, portado para a Lardan: despesas fixas (mensal/anual, parcelada,
pagar, pular mês, reajustar a partir de um mês, encerrar), despesas variáveis e receitas (únicas ou recorrentes,
editar/excluir "só esta" ou "esta e as próximas"), categorias/contas/projetos, gráficos, relatório anual e CSV.

## 1. Migração `drizzle/migrations/0177_financeiro_familia.sql`
- 7 tabelas novas `familia_*` e 2 rotinas (`familia_garantir_categorias_padrao`, `familia_reajustar_fixa`). Idempotente.
- **Privado de verdade:** cada linha é do login que criou (`user_id DEFAULT auth.uid()`), FORCE RLS, políticas só do dono.
  Nem Master, diretoria ou financeiro leem. Sem `audit_logs` (é a vida pessoal da pessoa). Nada da Lardan lê essas tabelas.
- Categorias padrão incluem **"Ganhos LARDAN"** nas receitas.
- Todo UPDATE/DELETE tem WHERE (safeupdate de produção).
- Depois de aplicar, **regenere `src/integrations/supabase/types.ts`** (a api usa um cast até lá).

## 2. Telas
- Novos: `src/lib/familia/` (tipos, datas, dinheiro, motor, api) e `src/components/familia/`
  (FinanceiroFamilia, dialogos, CadastrosDialog, componentes, AGENTS.md). Mobile primeiro: botões de 44px+, filtros
  recolhíveis no celular, ano em cartões no celular e tabela no computador, data pelo calendário do próprio aparelho.
- **Consultora:** nova aba `familia` ("Financeiro da família") no menu lateral, no menu do celular e em "Mais"
  (`AppConsultora.tsx`, `routes/_authenticated/consultora.tsx`). Não mexi nos atalhos da tela inicial.
- **Representante:** nova aba "Família" (`routes/_authenticated/representante.tsx`, barra de baixo com 7 colunas).
  No **espelho** (`?rep=`, Master/Daniel) a aba aparece **trancada** e não consulta nada.

## 3. Testes
- `tests/isolado/financeiro-familia.test.ts` (6): ninguém mais vê/altera (nem Master), sem anon, não grava em nome de outro
  nem troca dono, não usa categoria de outra pessoa, reajuste preserva histórico, categoria em uso não troca de tipo.
- `tests/isolado/familia-motor.test.ts` (18): o motor do sistema antigo, sem alteração.
- `tests/isolado/familia-independencia.test.ts` (5): módulo não importa nada da Lardan, só toca em `familia_*`,
  RLS só do dono e espelho trancado.
- Esperado em `bash tests/isolado/subir.sh && bun test tests/isolado`: **544 pass, 0 fail**.

## 4. Depois de aplicar, me devolva
Com um login de consultora: abrir Mais > Financeiro da família, cadastrar uma despesa fixa e uma receita.
Com o Master: abrir `/representante?rep=<id>` na aba Família e confirmar que aparece trancada.
