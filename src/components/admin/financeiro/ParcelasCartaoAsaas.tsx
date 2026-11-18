/**
 * Escolha de parcelas do cartão nas cobranças administrativas (acertos e dívidas).
 * Mesma regra do app da consultora (0329): 1x a 3x sem juros; 4x a 12x a cliente
 * paga a taxa do Asaas, somada para a Lardan receber o valor devido.
 * O Asaas só emite cartão parcelado com o número de parcelas definido; por isso
 * quem cobra escolhe aqui o que combinou com a cliente.
 */
import { SmartSelect } from "@/components/premium/SmartSelect";
import { PARCELAS_MAX, simularParcelas } from "@/lib/cartao-parcelas";

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function rotuloParcelas(baseCents: number, n: number) {
  const s = simularParcelas(baseCents, n);
  if (n === 1) return `À vista · ${brl(baseCents)}`;
  return s.semJuros ? `${n}x de ${brl(s.parcelaCents)} sem juros` : `${n}x de ${brl(s.parcelaCents)} · total ${brl(s.totalCents)}`;
}

export function ParcelasCartaoAsaas({ baseCents, value, onChange }: { baseCents: number; value: number; onChange: (n: number) => void }) {
  const s = simularParcelas(baseCents, value);
  return (
    <div className="space-y-2 rounded-[10px] border border-asaas/40 p-3" data-testid="parcelas-cartao-asaas">
      <span className="ledger-eyebrow text-asaas">Em quantas vezes no cartão?</span>
      <SmartSelect
        value={String(value)}
        onChange={(v) => onChange(Number(v))}
        placeholder="Parcelas"
        searchThreshold={99}
        options={Array.from({ length: PARCELAS_MAX }, (_, i) => ({ value: String(i + 1), label: rotuloParcelas(baseCents, i + 1) }))}
      />
      <p className="text-xs text-ledger-muted" data-testid="resumo-parcelas-cartao">
        {s.semJuros
          ? `Até 3x sem juros para a cliente. Ela paga ${brl(s.totalCents)}${value > 1 ? ` em ${value}x de ${brl(s.parcelaCents)}` : " à vista"}.`
          : `De 4x a 12x a cliente paga a taxa do cartão: ${brl(s.totalCents - baseCents)} a mais. Total ${brl(s.totalCents)} em ${value}x de ${brl(s.parcelaCents)}; a Lardan recebe o valor devido.`}
      </p>
      <p className="text-xs text-ledger-muted">
        Combine com a cliente em quantas vezes: o link do Asaas sai já nesse número de parcelas e cada parcela paga dá baixa sozinha.
      </p>
    </div>
  );
}
