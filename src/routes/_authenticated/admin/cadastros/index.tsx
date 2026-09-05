import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  UserPlus,
  Gem,
  Handshake,
  IdCard,
  ShoppingBag,
  ShieldCheck,
  Truck,
  Building2,
  Store,
  Package,
  Tag,
  Layers,
  Images,
  MapPin,
  Briefcase,
  Wallet,
  Landmark,
  Receipt,
  Route as RouteIcon,
  Barcode,
  type LucideIcon,
} from "lucide-react";
import { PageHeader, Panel, StatusBadge } from "@/components/admin/ui";
import { GlobalRegistrySearch } from "@/components/admin/GlobalRegistrySearch";
import { NewRecordPicker } from "@/components/admin/NewRecordPicker";
import { registryCounts } from "@/lib/registry";

export const Route = createFileRoute("/_authenticated/admin/cadastros/")({
  component: CentralDeCadastros,
  head: () => ({
    meta: [
      { title: "Central de Cadastros — LARDAN Cloud" },
      {
        name: "description",
        content: "Pessoas, empresas, produtos e estruturas que sustentam toda a operação LARDAN, em uma base única.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type Card = {
  label: string;
  icon: LucideIcon;
  texto: string;
  to?: string;
  contador?: string;
};

const GRUPOS: { titulo: string; nota: string; itens: Card[] }[] = [
  {
    titulo: "Pessoas e rede",
    nota: "Uma identidade só. A mesma pessoa pode acumular papéis sem virar cadastro repetido.",
    itens: [
      { label: "Pessoas", icon: Users, texto: "Base canônica de todas as pessoas físicas.", to: "/admin/cadastros/pessoas", contador: "pessoas" },
      { label: "Candidaturas", icon: UserPlus, texto: "Quem se inscreveu pelo Seja LARDAN.", to: "/admin/leads", contador: "candidaturas" },
      { label: "Consultoras", icon: Gem, texto: "Ficha comercial, carteira, maleta e acertos.", to: "/admin/cadastros/pessoas", contador: "consultoras" },
      { label: "Revendedoras", icon: ShoppingBag, texto: "Revenda com relacionamento próprio.", contador: "revendedoras" },
      { label: "Representantes", icon: Handshake, texto: "Quem responde por regiões e carteiras.", contador: "representantes" },
      { label: "Colaboradores", icon: IdCard, texto: "Time interno, com ou sem acesso ao sistema.", contador: "colaboradores" },
      { label: "Clientes", icon: Users, texto: "Consumidoras finais atendidas pela rede.", contador: "clientes" },
      { label: "Usuários e acessos", icon: ShieldCheck, texto: "Logins vinculados a pessoas e papéis.", to: "/admin/usuarios", contador: "usuarios" },
    ],
  },
  {
    titulo: "Empresas e parceiros",
    nota: "A mesma empresa pode ser fornecedora, transportadora e entidade do grupo.",
    itens: [
      { label: "Fornecedores", icon: Truck, texto: "Origem das peças, custos e compras.", to: "/admin/cadastros/fornecedores", contador: "fornecedores" },
      { label: "Entidades do grupo", icon: Building2, texto: "Empresas às quais estoque e financeiro pertencem.", to: "/admin/cadastros/entidades", contador: "entidades" },
      { label: "Prestadores", icon: Briefcase, texto: "Serviços contratados pela operação." },
      { label: "Transportadoras", icon: RouteIcon, texto: "Quem leva a peça até a consultora." },
      { label: "Lojas e parceiros", icon: Store, texto: "Pontos físicos e parcerias comerciais." },
    ],
  },
  {
    titulo: "Catálogo",
    nota: "A mesma peça no site, no estoque, na maleta e na venda.",
    itens: [
      { label: "Produtos", icon: Package, texto: "Ficha completa da peça.", to: "/admin/cadastros/produtos", contador: "produtos" },
      { label: "Variantes e SKUs", icon: Barcode, texto: "O que realmente é vendido e contado.", to: "/admin/cadastros/produtos", contador: "variantes" },
      { label: "Categorias", icon: Layers, texto: "Organização do catálogo público.", to: "/admin/cadastros/categorias", contador: "categorias" },
      { label: "Coleções", icon: Tag, texto: "Agrupamentos temáticos e sazonais.", to: "/admin/cadastros/colecoes", contador: "colecoes" },
      { label: "Biblioteca de imagens", icon: Images, texto: "Fotos com texto alternativo obrigatório." },
      { label: "Tabelas de preço", icon: Receipt, texto: "Preço público, revenda e condições." },
    ],
  },
  {
    titulo: "Estrutura operacional",
    nota: "Onde o estoque existe de verdade e quem responde por ele.",
    itens: [
      { label: "Depósitos e locais", icon: MapPin, texto: "Depósitos, lojas, maletas e trânsito.", to: "/admin/cadastros/locais", contador: "locais" },
      { label: "Maletas", icon: Briefcase, texto: "Peças sob custódia de cada consultora." },
      { label: "Responsáveis e custodiantes", icon: ShieldCheck, texto: "Quem responde por cada local." },
      { label: "Regiões e carteiras", icon: RouteIcon, texto: "Divisão comercial do país." },
      { label: "Motivos de movimentação", icon: Layers, texto: "Padroniza entradas, saídas e ajustes." },
      { label: "Códigos de barras", icon: Barcode, texto: "Regras de geração e leitura." },
    ],
  },
  {
    titulo: "Financeiro",
    nota: "Base de contas e classificações usadas por todo o dinheiro da operação.",
    itens: [
      { label: "Contas e caixas", icon: Wallet, texto: "Onde o dinheiro entra e sai." },
      { label: "Plano de contas", icon: Landmark, texto: "Classificação contábil das operações." },
      { label: "Centros de custo", icon: Layers, texto: "A que área cada custo pertence." },
      { label: "Formas e condições de pagamento", icon: Receipt, texto: "Prazos, parcelas e meios aceitos." },
      { label: "Contrapartes", icon: Handshake, texto: "Quem paga e quem recebe." },
    ],
  },
];

function CentralDeCadastros() {
  const counts = useQuery({ queryKey: ["registry", "counts"], queryFn: registryCounts });
  const c = counts.data ?? {};
  const n = (k?: string) => (k ? (c[k] ?? 0) : null);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Base operacional · Cadastros"
        title="Central de Cadastros"
        description="Pessoas, empresas, produtos e estruturas que sustentam toda a operação LARDAN."
        actions={<NewRecordPicker />}
      />

      <GlobalRegistrySearch />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { rotulo: "Cadastros de pessoas e empresas", valor: (c["pessoas"] ?? 0) + (c["organizacoes"] ?? 0) },
          { rotulo: "Cadastros incompletos", valor: c["incompletos"] ?? 0 },
          { rotulo: "Possíveis duplicidades", valor: c["duplicidades"] ?? 0 },
          { rotulo: "Atualizados nos últimos 7 dias", valor: c["atualizados_7d"] ?? 0 },
        ].map((k) => (
          <div key={k.rotulo} className="ledger-panel p-5">
            <p className="ledger-eyebrow">{k.rotulo}</p>
            <p className="num mt-2 text-3xl font-semibold text-ledger-text">{counts.isLoading ? "—" : k.valor}</p>
          </div>
        ))}
      </div>

      {GRUPOS.map((g) => (
        <Panel key={g.titulo} title={g.titulo} description={g.nota}>
          <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
            {g.itens.map((i) => {
              const total = n(i.contador);
              const conteudo = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <i.icon aria-hidden className="size-5 text-bronze" />
                    {i.to ? (
                      total !== null && <span className="num text-lg font-semibold text-ledger-text">{counts.isLoading ? "—" : total}</span>
                    ) : (
                      <StatusBadge tone="neutral">Em implantação</StatusBadge>
                    )}
                  </div>
                  <h3 className="mt-2 text-base font-semibold text-ledger-text">{i.label}</h3>
                  <p className="text-sm font-medium text-ledger-muted">{i.texto}</p>
                </>
              );
              return i.to ? (
                <Link
                  key={i.label}
                  to={i.to}
                  className="rounded-xl border border-line bg-surface p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  {conteudo}
                </Link>
              ) : (
                <div key={i.label} className="rounded-xl border border-line-soft bg-surface-muted/40 p-4">
                  {conteudo}
                </div>
              );
            })}
          </div>
        </Panel>
      ))}
    </div>
  );
}
