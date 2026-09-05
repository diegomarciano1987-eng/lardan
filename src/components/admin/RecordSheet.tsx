import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface FieldSpec {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "switch" | "select" | "date";
  options?: { value: string; label: string }[];
  required?: boolean;
  help?: string;
  placeholder?: string;
  /** ocupa a linha inteira */
  full?: boolean;
}

export type RecordValues = Record<string, unknown>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: FieldSpec[];
  initial?: RecordValues;
  onSubmit: (values: RecordValues) => Promise<void>;
  extra?: React.ReactNode;
}

/** Formulário lateral padrão dos cadastros. Só controles premium. */
export function RecordSheet({
  open,
  onOpenChange,
  title,
  description,
  fields,
  initial,
  onSubmit,
  extra,
}: Props) {
  const [values, setValues] = useState<RecordValues>(initial ?? {});
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (open) setValues(initial ?? {});
  }, [open, initial]);

  const set = (name: string, value: unknown) =>
    setValues((v) => ({ ...v, [name]: value }));

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    for (const f of fields) {
      if (f.required && !String(values[f.name] ?? "").trim()) {
        toast.error(`Preencha o campo ${f.label}.`);
        return;
      }
    }
    setSalvando(true);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto bg-surface sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="text-ledger-text">{title}</SheetTitle>
          {description && (
            <SheetDescription className="text-ledger-muted">{description}</SheetDescription>
          )}
        </SheetHeader>

        <form onSubmit={submeter} className="grid grid-cols-2 gap-4 px-4 pb-8">
          {fields.map((f) => (
            <div key={f.name} className={cn("min-w-0", (f.full || f.type === "textarea") && "col-span-2")}>
              <label htmlFor={f.name} className="ledger-eyebrow">
                {f.label}
                {f.required && <span className="text-danger"> *</span>}
              </label>
              <div className="mt-1.5">
                {f.type === "textarea" ? (
                  <textarea
                    id={f.name}
                    value={String(values[f.name] ?? "")}
                    onChange={(e) => set(f.name, e.target.value)}
                    rows={4}
                    placeholder={f.placeholder ?? ""}
                    className="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm text-ledger-text outline-none focus:border-champagne"
                  />
                ) : f.type === "select" ? (
                  <SmartSelect
                    id={f.name}
                    value={String(values[f.name] ?? "")}
                    onChange={(v) => set(f.name, v)}
                    options={f.options ?? []}
                    placeholder={f.placeholder ?? "Selecionar"}
                  />
                ) : f.type === "switch" ? (
                  <Switch
                    id={f.name}
                    checked={Boolean(values[f.name])}
                    onCheckedChange={(v) => set(f.name, v)}
                  />
                ) : f.type === "date" ? (
                  <DateField
                    id={f.name}
                    value={values[f.name] ? new Date(String(values[f.name])) : undefined}
                    onChange={(d) => set(f.name, d ? d.toISOString().slice(0, 10) : "")}
                  />
                ) : (
                  <input
                    id={f.name}
                    inputMode={f.type === "number" ? "decimal" : "text"}
                    value={String(values[f.name] ?? "")}
                    onChange={(e) => set(f.name, e.target.value)}
                    placeholder={f.placeholder ?? ""}
                    className="h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm text-ledger-text outline-none placeholder:text-ledger-muted focus:border-champagne"
                  />
                )}
              </div>
              {f.help && <p className="mt-1 text-xs text-ledger-muted">{f.help}</p>}
            </div>
          ))}

          {extra && <div className="col-span-2">{extra}</div>}

          <div className="col-span-2 flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={salvando}
              className="admin-btn-primary"
            >
              {salvando && <Loader2 aria-hidden className="size-4 animate-spin" />}
              Salvar
            </button>
            <button type="button" className="admin-btn" onClick={() => onOpenChange(false)}>
              Cancelar
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
