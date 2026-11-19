# Financeiro
- Consultant-app client charges (financial_titles.origem='consultora') stay out of fin_titles_list, fin_overview, fin_pagar_receber, fin_cashflow(_detail) until any allocation exists (fin_pedido_consultora_aguardando); pagar-receber shows only a count/value note. Why: unpaid street invoices are not Lardan receivables (0351).
