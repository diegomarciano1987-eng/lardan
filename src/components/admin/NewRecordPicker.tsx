import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Loader2, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addRole, saveParty, type PartyRoleKind } from "@/lib/registry";

type Destino =
  | { tipo: "pessoa"; role: PartyRoleKind }
  | { tipo: "organizacao"; role: PartyRoleKind }
  | { tipo: "rota"; to: string }
  | { tipo: "em_implantacao" };

interface Opcao {
  label: string;
  descricao: string;
  destino: Destino;
  grupo: string;
}

const OPCOES: Opcao[] = [
  { grupo: "Pessoas e rede", label: "Pessoa", descricao: "Identidade central, sem papel definido ainda.", destino: { tipo: "pessoa", role: "cliente" } },
  { grupo: "Pessoas e rede", label: "Consultora", descricao: "Pessoa com papel de consultora e ficha comercial.", destino: { tipo: "pessoa", role: "consultora" } },
  { grupo: "Pessoas e rede", label: "Representante", descricao: "Responsável por região e carteira de consultoras.", destino: { tipo: "pessoa", role: "representante" } },
  { grupo: "Pessoas e rede", label: "Revendedora", descricao: "Revenda vinculada à rede.", destino: { tipo: "pessoa", role: "revendedora" } },
  { grupo: "Pessoas e rede", label: "Colaborador", descricao: "Equipe interna; o acesso é vinculado depois.", destino: { tipo: "pessoa", role: "colaborador" } },
  { grupo: "Pessoas e rede", label: "Cliente", descricao: "Cliente final com dados mínimos autorizados.", destino: { tipo: "pessoa", role: "cliente" } },

  { grupo: "Empresas e parceiros", label: "Fornecedor", descricao: "Mesmo cadastro usado em Produtos, Compras e Financeiro.", destino: { tipo: "rota", to: "/admin/cadastros/fornecedores" } },
  { grupo: "Empresas e parceiros", label: "Empresa / entidade do grupo", descricao: "Empresa à qual estoque e financeiro pertencem.", destino: { tipo: "rota", to: "/admin/cadastros/entidades" } },

  { grupo: "Catálogo", label: "Produto", descricao: "Mesmo produto usado no site, estoque e vendas.", destino: { tipo: "rota", to: "/admin/cadastros/produtos" } },
  { grupo: "Catálogo", label: "Categoria", descricao: "Organização do catálogo público.", destino: { tipo: "rota", to: "/admin/cadastros/categorias" } },
  { grupo: "Catálogo", label: "Coleção", descricao: "Agrupamento temático ou sazonal.", destino: { tipo: "rota", to: "/admin/cadastros/colecoes" } },

  { grupo: "Estrutura operacional", label: "Local (depósito ou loja)", descricao: "Onde o estoque existe de verdade.", destino: { tipo: "rota", to: "/admin/cadastros/locais" } },
  { grupo: "Estrutura operacional", label: "Maleta", descricao: "Cadastrada como local do tipo maleta.", destino: { tipo: "rota", to: "/admin/cadastros/locais" } },

  { grupo: "Financeiro", label: "Conta financeira", descricao: "Depende do motor financeiro.", destino: { tipo: "em_implantacao" } },
  { grupo: "Financeiro", label: "Centro de custo", descricao: "Depende do motor financeiro.", destino: { tipo: "em_implantacao" } },
];

/** Seletor único de “o que você deseja cadastrar”. Abre sempre o formulário canônico. */
export function NewRecordPicker() {
  const [aberto, setAberto] = useState(false);
  const [criando, setCriando] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const grupos = [...new Set(OPCOES.map((o) => o.grupo))];

  async function escolher(o: Opcao) {
    if (o.destino.tipo === "em_implantacao") return;
    if (o.destino.tipo === "rota") {
      setAberto(false);
      void navigate({ to: o.destino.to as never });
      return;
    }
    try {
      setCriando(o.label);
      const id = await saveParty({
        kind: o.destino.tipo === "pessoa" ? "pessoa" : "organizacao",
        status: "rascunho",
      });
      if (o.destino.role) await addRole(id, o.destino.role);
      await qc.invalidateQueries({ queryKey: ["registry"] });
      setAberto(false);
      toast.success("Rascunho criado. Complete quando quiser.");
      void navigate({ to: "/admin/cadastros/pessoas/$id", params: { id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível criar o cadastro.");
    } finally {
      setCriando(null);
    }
  }

  return (
    <>
      <button type="button" className="btn-premium" onClick={() => setAberto(true)}>
        <Plus aria-hidden className="size-4" /> Novo cadastro
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-semibold">O que você deseja cadastrar?</DialogTitle>
            <DialogDescription className="font-medium">
              Cada opção abre o mesmo formulário usado pelo módulo especializado. Nada é duplicado.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {grupos.map((g) => (
              <section key={g}>
                <p className="ledger-eyebrow mb-2">{g}</p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {OPCOES.filter((o) => o.grupo === g).map((o) => {
                    const bloqueado = o.destino.tipo === "em_implantacao";
                    return (
                      <li key={o.label}>
                        <button
                          type="button"
                          disabled={bloqueado || criando !== null}
                          onClick={() => void escolher(o)}
                          className="flex w-full flex-col items-start gap-1 rounded-xl border border-line bg-surface p-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-champagne hover:shadow-md disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:border-line disabled:hover:shadow-sm"
                        >
                          <span className="flex w-full items-center gap-2 text-sm font-semibold text-ledger-text">
                            {o.label}
                            {criando === o.label && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
                            {bloqueado && (
                              <span className="ml-auto inline-flex items-center gap-1 text-[0.625rem] font-semibold tracking-[0.08em] text-ledger-muted uppercase">
                                <Lock aria-hidden className="size-3" /> Em implantação
                              </span>
                            )}
                          </span>
                          <span className="text-xs font-medium text-ledger-muted">{o.descricao}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
