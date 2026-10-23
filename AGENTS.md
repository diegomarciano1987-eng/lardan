<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Save roles atomically via protected audited RPCs. Full finance grants live in user_financial_access, never Master; preserve MFA. Why: no unrelated grants.
- Balances sum financial_account_movements through America/Sao_Paulo cutoff; never re-add saldo_inicial. All financial RPCs treat future movements as forecast. Why: no double/future cash.
- fin_dre separates unclassified titles, missing cost centers, non-DRE natures, open installments and unreconciled lines; gerencial uses fin_dre_base and matches net profit. Why: one calculation, distinct indicators.
- Installment competencia falls back to title; changes only via fin_installment_competencia_set with reason/event; DRE sums by installment. Why: recurring contracts span months.
- Count transfers once on outgoing side; report is_implantacao transfers separately while showing both movements. Why: no doubling, preserved reconciliation.
- Reconciliation creates titles via fin_title_create (origem conciliacao, id_externo extrato:<line>); fin_mesa_palpite learns only for new titles. Existing links preserve classification. Why: no reclassification/automatic settlement.
- Reconciliation fees are separate movements, never installment adjustments: receipt=line allocation-fee; payment=allocation+fee. Why: fees do not increase debt.
- Asaas PAYMENT_RECEIVED settles linked installments via asaas_baixa_automatica: gross, separate fee, key asaas:baixa:<account>:<charge>. Cash/refunds/disputes stay manual. Why: official idempotency.
- Isolated bench applies supabase/migrations and nonduplicated drizzle/migrations; exclusions live in tests/isolado/pular.txt. Why: migration tool writes to drizzle.
- Cheques use fin_cheque_* custody and enter bank balance only at compensado via official settlement when linked; fin_caixa_fatias is insert-only. Why: no fake accounts or double counting.
- Card purchases hit DRE by purchase date/category; cartao_fatura payable is excluded from competencia; invoice payments split by line category. Why: no double counting.
- Historical fiado: service-only cob_fiado_importar, batch+line idempotency, receivable sistema_origem fiado_historico, FIADO-HIST asset outside DRE, immutable cob_fiado_linhas. Why: traceable debt, no inflated revenue.
- Consultant charges: consultora_pagamento_titulo on owned orders, valid CPF, Asaas actor consultora_cobranca_config.ator_user_id; sales_orders.pay_* offsets kit settlement. Why: no finance permissions.
- Approved cleanup: service-only fin_expurgo_* with fin_expurgo_backup/audit_logs; zero-sum cancelled reversals: fin_expurgo_titulos_estornados. Why: reversible.
- Asaas button/daily cron: /api/public/asaas/sync-matinal. asaas_conciliar_cobranca matches party/CPF/legacy first five externalReference digits only for unique person+value+due date or unique value within 60 days without competing charge; RECEIVED settles, cash manual. Why: no wrong match.
- Settlement reversal reverses its interest/discount; DFC nets reversal in original line; projected flow skips cheques represented by equal open receivable. Why: no residues/doubling.
- Date correction: fin_estorno_data_corrigir, expected date, reason, immutable snapshots, atomic settlement/movement updates; invalidate account/cashflow queries. Why: dated balances/concurrency.
- Merges: party_unificar after preview, atomic; preserve fiado/Asaas stage and moved IDs in party_unificacoes. Why: history/reversal.
- Read nested AGENTS.md before edits. Why: scoped rules.
- Consultant reads are owner-scoped; preserve paid-item after-sale snapshots; review never moves stock/money automatically. Why: privacy/official engines.
- pdv_como validates/audits real actor; no GRANT. Why: traceability.
- Biblioteca type is separate from social format; shared publication/storage policies. Why: preserve arts/privacy.
- Outside portfolio: name/code/status/debt only, restrito=true; blocked/departed cannot move portfolio/reactivate. Why: privacy/finance.
- With asaas_accounts.conta_cartao_receber_id set, settle there; asaas_cartao_creditar transfers to Asaas idempotently on/after credit_date, skipping reversed settlements. Empty preserves old behavior; asaas_baixa_pendentes sweeps lost-webhook credits. Why: accurate cash timing/recovery.
- All installment balances use fin_installment_saldo: amount + interest/fine - discount/abatement - allocations. Never valor minus allocations. Why: one balance.
- Test-kit cleanup: service-only kit_testes_cancelar, seven expected cycles/quantities, official transfers, immutable snapshots; retain history. Why: stock/remessas.
- Fiscal results (attempt/authorization/rejection/homologated cancellation): service_role only (db/pendentes/11). Authorization requires nfe_chave_valida with emitter CNPJ; model/series/number from key. Why: no manual authorization.
- fiscal_settings emission/provider/environment/emitter changes: Master only, provider+emitter+environment required before activation, disable before environment change, audit fiscal.configuracao_alterada. Why: controlled fiscal switch.
- fiscal_prontidao: counts only, no personal data. Why: privacy.
- Montagem-by-scanner goals come from montagem_metas_ciclo (0113): read-only, staff only, categories mapped by legado_categoria_tipo (Master edits via legado_categoria_tipo_definir, audited); on error the scanner falls back to remessa_parametros. No text input in the scanner overlay (focus returns to the barcode field every 400 ms). Why: suggestion never touches stock or the kit.
- SmallData history (legado_*, 0112–0125; BI _data acerto|saida): sales value = cobrança do acerto (legado_acertos_consultora.fonte = 'cobranca', Vlr. Bruto na Data Cob.); a closed maleta without cobrança counts zero (sem_cobranca); BI totals (kpis, anos) include internal records like SmallData; rankings, jornada and alertas exclude them. No direct grants; staff reads via legado_pode_ver (never can_view_kits); BI only via legado_bi_*; open maletas without acerto have unknown sales (null); people only via legado_consultoras_cadastrar (service; skips CPF, legacy code and same-name matches); CSVs never in repo. Why: privacy, no duplicates, match the official SmallData collection report.
- Focus NFe (0118): homologação only; fiscal_focus_* writes are service_role (server fns check fiscal_focus_pode first); payload from src/lib/focus/nfe.ts roteiro (5917/1918/5114/5927, CSOSN 102, 1/3 retail) — never change roteiro to dodge a SEFAZ rejection; tokens/secrets only in Lovable secrets. Why: fiscal safety.
- Consultant maletas (0120): consultora_maletas/maletas_visibilidade are read-only; a Lardan maleta shows in the consultant app only in expedida/transito/recebida/operacao/acerto and when her active login is on the SAME party (duplicates hide it); SmallData open maletas exist only in legado_*. Why: explain "maleta não aparece".
- Consultant commission tiers apply to the remessa total: UI uses comissaoPorRemessa (src/lib/comissao-maletas.ts) and consultora_ganhos sums every open cycle of the same remessa. Why: splitting kits lowers the tier.
- SmallData settled-history reads count a settled kit even when its remessa is open; the free ranking defaults to settlement date, and the monthly company series includes internal records (unlike consultant BI). Why: match SmallData settlement timing without treating unsettled kits as sales.
- Product banho (0126): banho_tipo/banho_camada on products (dourado 1/2/3/5/7, prata_banhada 30/70); banho_valor_grama_cents is cost (read only via product_costs_read); cost = raw_weight_grams × banho_valor_grama_cents + raw_piece_cost_cents only when custo_pelo_banho or the product has no cost yet — existing costs never change; catalog reclassification only via produto_reclassificar (preview first, Master approval, fills empty fields only, logged in produto_reclassificacao, undo by lote).
- SmallData maleta situation (0127): legado_maleta_status per remessa+codcli from maletas_status.csv; 'na rua' = no fechamento AND legado_maleta_situacoes.na_rua (Master edits names/rule via legado_maleta_situacao_definir); counts show consultoras first, maletas second.
- Product cost display (list column, ficha fields, suggested price) is gated by catalog.cost.view and fetched via product_costs_read, never by selecting cost_price_cents in list queries. Why: cost secrecy per profile.
