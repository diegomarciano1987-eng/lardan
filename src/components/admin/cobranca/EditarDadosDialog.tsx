import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { lerCadastro, salvarCadastro } from "@/lib/cobranca";

type Form = Record<string, string>;
const CAMPOS_END = [["cep", "CEP"], ["rua", "Rua"], ["numero", "Número"], ["complemento", "Complemento"], ["bairro", "Bairro"], ["cidade", "Cidade"], ["uf", "UF"]] as const;

export function EditarDadosDialog({ open, onOpenChange, partyId, onSalvo }: { open: boolean; onOpenChange: (v: boolean) => void; partyId: string; onSalvo: () => void }) {
  const q = useQuery({ queryKey: ["cob", "cadastro", partyId], queryFn: () => lerCadastro(partyId), enabled: open });
  const [f, setF] = React.useState<Form>({});
  const [salvando, setSalvando] = React.useState(false);
  React.useEffect(() => {
    if (!q.data) return;
    const e = q.data.endereco ?? ({} as Record<string, string | null>);
    setF({ nome: q.data.nome ?? "", cpf: "", whatsapp: q.data.whatsapp ?? "", telefone: q.data.telefone ?? "", email: q.data.email ?? "",
      ...Object.fromEntries(CAMPOS_END.map(([k]) => [k, (e as Record<string, string | null>)[k] ?? ""])) });
  }, [q.data]);
  const set = (k: string) => (ev: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: ev.target.value }));
  const inp = "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm";

  const salvar = async () => {
    setSalvando(true);
    try {
      await salvarCadastro(partyId, { nome: f.nome, cpf: f.cpf, whatsapp: f.whatsapp, telefone: f.telefone, email: f.email,
        endereco: Object.fromEntries(CAMPOS_END.map(([k]) => [k, f[k] ?? ""])) });
      toast.success("Dados atualizados.");
      onOpenChange(false); onSalvo();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não salvou."); } finally { setSalvando(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar dados do cliente</DialogTitle>
          <DialogDescription>Fica registrado no histórico da cobrança, com quem alterou e o que mudou.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <p className="text-sm text-ledger-muted">Carregando…</p> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 text-xs text-ledger-muted">Nome<input value={f.nome ?? ""} onChange={set("nome")} className={inp} /></label>
              <label className="text-xs text-ledger-muted">CPF {q.data?.tem_cpf ? `(atual ${q.data.cpf}; deixe em branco para manter)` : "(não informado)"}<input value={f.cpf ?? ""} onChange={set("cpf")} placeholder="000.000.000-00" className={inp} /></label>
              <label className="text-xs text-ledger-muted">WhatsApp<input value={f.whatsapp ?? ""} onChange={set("whatsapp")} className={inp} /></label>
              <label className="text-xs text-ledger-muted">Telefone<input value={f.telefone ?? ""} onChange={set("telefone")} className={inp} /></label>
              <label className="text-xs text-ledger-muted">E-mail<input value={f.email ?? ""} onChange={set("email")} className={inp} /></label>
            </div>
            <div className="grid grid-cols-6 gap-3">
              {CAMPOS_END.map(([k, r]) => (
                <label key={k} className={`text-xs text-ledger-muted ${k === "rua" || k === "cidade" ? "col-span-3" : k === "uf" || k === "numero" ? "col-span-1" : "col-span-2"}`}>{r}<input value={f[k] ?? ""} onChange={set(k)} className={inp} maxLength={k === "uf" ? 2 : undefined} /></label>
              ))}
            </div>
            <button disabled={salvando} onClick={salvar} className="h-10 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">{salvando ? "Salvando…" : "Salvar dados"}</button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
