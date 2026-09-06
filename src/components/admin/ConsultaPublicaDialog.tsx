import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { consultarCep, consultarCnpj } from "@/lib/br/lookup.functions";
import {
  formatarCep,
  formatarCnpj,
  formatarCpf,
  normalizarCep,
  normalizarCnpj,
  normalizarCpf,
} from "@/lib/br/canonico";

type Tipo = "cnpj" | "cpf" | "cep";

const TIPOS = [
  { value: "cnpj", label: "CNPJ — dados públicos da empresa" },
  { value: "cpf", label: "CPF — validação estrutural" },
  { value: "cep", label: "CEP — endereço oficial" },
];

interface Linha {
  rotulo: string;
  valor: string;
}

/**
 * Consulta avulsa: mostra exatamente o que as bases públicas devolvem,
 * sem gravar nada em cadastro nenhum.
 */
export function ConsultaPublicaDialog() {
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<Tipo>("cnpj");
  const [entrada, setEntrada] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [origem, setOrigem] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<Linha[] | null>(null);

  const limpar = () => {
    setErro(null);
    setLinhas(null);
    setOrigem(null);
  };

  async function consultar() {
    limpar();
    setCarregando(true);
    try {
      if (tipo === "cpf") {
        const c = normalizarCpf(entrada);
        if (c.estado !== "valido") {
          setErro(c.erro ?? "CPF inválido.");
          return;
        }
        setOrigem("Validação local · nenhuma base pública consulta CPF");
        setLinhas([
          { rotulo: "CPF", valor: formatarCpf(c.canonico ?? "") },
          { rotulo: "Situação estrutural", valor: "Dígitos verificadores conferem" },
          {
            rotulo: "Observação",
            valor: "Isso não prova titularidade nem situação na Receita Federal.",
          },
        ]);
        return;
      }

      if (tipo === "cep") {
        const c = normalizarCep(entrada);
        if (c.estado !== "valido") {
          setErro(c.erro ?? "CEP inválido.");
          return;
        }
        const r = await consultarCep({ data: { cep: c.canonico as string } });
        if (r.status !== "ok" || !r.dados) {
          setErro(r.mensagem ?? "Não foi possível consultar o CEP agora.");
          return;
        }
        const d = r.dados;
        setOrigem(`${r.provider}${r.cache ? " · resposta guardada" : ""}`);
        setLinhas([
          { rotulo: "CEP", valor: formatarCep(d.cep) },
          { rotulo: "Logradouro", valor: d.logradouro ?? "—" },
          { rotulo: "Complemento", valor: d.complemento ?? "—" },
          { rotulo: "Bairro", valor: d.bairro ?? "—" },
          { rotulo: "Cidade", valor: d.cidade ?? "—" },
          { rotulo: "UF", valor: d.uf ?? "—" },
          { rotulo: "Código IBGE", valor: d.ibge ?? "—" },
          { rotulo: "DDD", valor: d.ddd ?? "—" },
        ]);
        return;
      }

      const c = normalizarCnpj(entrada);
      if (c.estado !== "valido") {
        setErro(c.erro ?? "CNPJ inválido.");
        return;
      }
      const r = await consultarCnpj({ data: { cnpj: c.canonico as string, comQsa: true } });
      if (r.status !== "ok" || !r.dados) {
        setErro(r.mensagem ?? "Não foi possível consultar o CNPJ agora.");
        return;
      }
      const d = r.dados;
      const dinheiro =
        d.capital_social === null
          ? "—"
          : d.capital_social.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      setOrigem(`${r.provider}${r.cache ? " · resposta guardada" : ""}`);
      setLinhas([
        { rotulo: "CNPJ", valor: formatarCnpj(d.cnpj) },
        { rotulo: "Razão social", valor: d.razao_social ?? "—" },
        { rotulo: "Nome fantasia", valor: d.nome_fantasia ?? "—" },
        { rotulo: "Situação cadastral", valor: d.situacao ?? "—" },
        { rotulo: "Data da situação", valor: d.situacao_data ?? "—" },
        { rotulo: "Abertura", valor: d.abertura ?? "—" },
        { rotulo: "Natureza jurídica", valor: d.natureza_juridica ?? "—" },
        { rotulo: "Porte", valor: d.porte ?? "—" },
        { rotulo: "Capital social", valor: dinheiro },
        { rotulo: "Atividade principal", valor: d.atividade_principal ?? "—" },
        {
          rotulo: "Atividades secundárias",
          valor: d.atividades_secundarias.length ? d.atividades_secundarias.join(" · ") : "—",
        },
        {
          rotulo: "Endereço",
          valor:
            [d.logradouro, d.numero, d.complemento, d.bairro].filter(Boolean).join(", ") || "—",
        },
        {
          rotulo: "Município / UF",
          valor: [d.cidade, d.uf].filter(Boolean).join(" / ") || "—",
        },
        { rotulo: "CEP", valor: d.cep ? formatarCep(d.cep) : "—" },
        { rotulo: "Telefone", valor: d.telefone ?? "—" },
        { rotulo: "E-mail", valor: d.email ?? "—" },
        {
          rotulo: "Quadro societário",
          valor: d.socios.length
            ? d.socios.map((s) => `${s.nome}${s.qualificacao ? ` (${s.qualificacao})` : ""}`).join(" · ")
            : "—",
        },
      ]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Consulta indisponível agora.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v) {
          limpar();
          setEntrada("");
        }
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className="admin-btn border-champagne">
          <Search aria-hidden className="size-4" /> Consultar
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-surface sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-ledger-text">Consulta pública</DialogTitle>
          <DialogDescription className="text-ledger-muted">
            Veja o que as bases oficiais devolvem para um CNPJ, CPF ou CEP. Nada é gravado em cadastro.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0">
            <label className="ledger-eyebrow">Tipo de consulta</label>
            <div className="mt-1.5">
              <SmartSelect
                value={tipo}
                onChange={(v) => {
                  setTipo(v as Tipo);
                  limpar();
                }}
                options={TIPOS}
                placeholder="Selecionar"
              />
            </div>
          </div>
          <div className="min-w-0">
            <label htmlFor="consulta-valor" className="ledger-eyebrow">
              Número
            </label>
            <input
              id="consulta-valor"
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void consultar();
              }}
              placeholder={tipo === "cep" ? "00000-000" : tipo === "cpf" ? "000.000.000-00" : "00.000.000/0000-00"}
              className="mt-1.5 h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm text-ledger-text outline-none placeholder:text-ledger-muted focus:border-champagne"
            />
          </div>
          <button
            type="button"
            className="admin-btn-primary h-11"
            disabled={carregando}
            onClick={() => void consultar()}
          >
            {carregando ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <Search aria-hidden className="size-4" />
            )}
            Consultar
          </button>
        </div>

        {erro && (
          <p className="rounded-[10px] border border-line bg-surface-muted/50 p-4 text-sm font-medium text-danger">
            {erro}
          </p>
        )}

        {linhas && (
          <div className="rounded-[12px] border border-line bg-surface-muted/30 p-5">
            {origem && (
              <div className="mb-3 flex items-center gap-2">
                <StatusBadge tone="success">Consulta concluída</StatusBadge>
                <span className="text-xs text-ledger-muted">Fonte: {origem}</span>
              </div>
            )}
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {linhas.map((l) => (
                <div key={l.rotulo} className="min-w-0">
                  <dt className="ledger-eyebrow">{l.rotulo}</dt>
                  <dd className="mt-1 break-words text-sm font-medium text-ledger-text">{l.valor}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
