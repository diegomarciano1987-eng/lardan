import * as React from "react";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { buscarPecaTroca, brlTroca, type PecaBusca } from "@/lib/qualidade-trocas";

/** Busca de peça no servidor por referência da etiqueta, código de barras ou nome em partes. */
export function PecaTrocaPicker({
  value,
  onChange,
  placeholder = "Buscar peça: referência (LANP0342), código de barras ou nome",
  id,
}: {
  value: PecaBusca | null;
  onChange: (p: PecaBusca | null) => void;
  placeholder?: string;
  id?: string;
}) {
  const [termo, setTermo] = React.useState("");
  const [rows, setRows] = React.useState<PecaBusca[]>([]);
  const [carregando, setCarregando] = React.useState(false);
  const [erro, setErro] = React.useState(false);
  React.useEffect(() => {
    const t = termo.trim();
    if (t.length < 2) { setRows([]); return; }
    let cancel = false;
    setCarregando(true);
    const h = setTimeout(() => {
      buscarPecaTroca(t)
        .then((r) => { if (!cancel) { setRows(r); setErro(false); } })
        .catch(() => { if (!cancel) setErro(true); })
        .finally(() => { if (!cancel) setCarregando(false); });
    }, 250);
    return () => { cancel = true; clearTimeout(h); };
  }, [termo]);
  const opcoes = React.useMemo(() => {
    const base = rows.map((p) => ({ value: p.id, label: `${p.referencia ?? "s/ ref"} · ${p.nome}`, hint: `${p.tamanho ? `Tam. ${p.tamanho} · ` : ""}${brlTroca(p.valor_cents)}` }));
    if (value && !rows.some((r) => r.id === value.id)) base.unshift({ value: value.id, label: `${value.referencia ?? "s/ ref"} · ${value.nome}`, hint: brlTroca(value.valor_cents) });
    return base;
  }, [rows, value]);
  return (
    <SmartSelect
      id={id}
      options={opcoes}
      value={value?.id ?? ""}
      onChange={(v) => onChange(rows.find((r) => r.id === v) ?? (value?.id === v ? value : null))}
      placeholder={placeholder}
      searchPlaceholder="Referência, código de barras ou nome"
      emptyLabel={erro ? "Falha ao buscar peças." : termo.trim().length < 2 ? "Digite ao menos 2 letras ou números." : "Nenhuma peça encontrada."}
      searchThreshold={0}
      onSearch={setTermo}
      loading={carregando}
    />
  );
}
