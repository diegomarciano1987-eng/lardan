# Cobrança

- Agreement (acordo) Asaas charges are intents tagged acordo_simulacao_id anchored on the oldest open debt installment; their baixa (cob_acordo_baixa) spreads the payment oldest-first across the agreement's original installments, excess = juros, agreed discount only after the last part is paid. Why: no new receivable title, so no double counting.
- Judicial agreements (cob_judicial_acordos) are standalone records written only via cob_judicial_* RPCs, require the case to be forwarded to judicial first, and never create Asaas charges or touch financial titles; judicial docs live privately under judicial/<party>/ in the comprovantes bucket. Why: court deals must not trigger automatic collection.
