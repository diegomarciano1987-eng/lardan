import { createFileRoute, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { vitrinePublica, type VitrineItem } from "@/lib/maletas";
import { VitrineView } from "@/components/vitrine/VitrineView";
import { arquivoPublico, type DesignVitrine } from "@/lib/vitrine-design";

const SITE = "https://www.lardan.com.br";
type Publica = Awaited<ReturnType<typeof vitrinePublica>> & { design?: Partial<DesignVitrine> | null };

export const Route = createFileRoute("/$slug")({
  loader: async ({ params }) => {
    const dados = (await vitrinePublica(params.slug)) as Publica | null;
    if (!dados) throw notFound();
    return dados;
  },
  component: VitrineConsultora,
  head: ({ loaderData }) => {
    const d = loaderData?.design;
    const nome = loaderData?.nome ?? "Vitrine";
    const titulo = d?.compartilhar?.titulo || `${nome} · Semijoias LARDAN`;
    const descricao =
      d?.compartilhar?.descricao || loaderData?.headline || `Peças LARDAN disponíveis com ${nome}. Escolha suas peças e fale direto com a consultora.`;
    const og = d?.compartilhar?.imagem ? `${SITE}${arquivoPublico(d.compartilhar.imagem)}` : null;
    return {
      meta: [
        { title: titulo },
        { name: "description", content: descricao },
        { property: "og:title", content: titulo },
        { property: "og:description", content: descricao },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        ...(og ? [{ property: "og:image", content: og }, { name: "twitter:image", content: og }] : []),
      ],
    };
  },
});

function VitrineConsultora() {
  const dados = Route.useLoaderData();
  const { slug } = Route.useParams();
  const vitrine = useQuery({
    queryKey: ["vitrine", slug],
    queryFn: async () => (await vitrinePublica(slug)) as Publica | null,
    initialData: dados,
    refetchOnWindowFocus: true,
  });
  const v = vitrine.data ?? dados;
  return (
    <VitrineView
      design={v.design ?? { perfil: { nome: "", frase: v.headline ?? "", bio: v.bio ?? "" } as DesignVitrine["perfil"], contato: { whatsapp: v.whatsapp ?? "" } as DesignVitrine["contato"] }}
      nome={v.nome}
      itens={v.itens as VitrineItem[]}
      img={arquivoPublico}
    />
  );
}
