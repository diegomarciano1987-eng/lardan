/** SEO-only edits: never used to render visible headings or body content. */
const OVERRIDES: Record<string, { title?: string; description?: string }> = {
  "/seja-lardan": {
    title: "Seja Consultora Lardan | Venda Semijoias com Suporte",
    description: "Seja Consultora Lardan: conheça as semijoias, o CRM, as ferramentas de vendas, o treinamento e o suporte para desenvolver seu negócio.",
  },
  "/renda-extra-com-vendas": { title: "Renda Extra com Vendas: Como Começar | Lardan" },
  "/como-comecar-a-vender-semijoias": { title: "Como Começar a Vender Semijoias do Zero | Lardan" },
  "/semijoias-consignadas-para-revenda": { title: "Semijoias Consignadas para Revenda: Como Funciona | Lardan" },
  "/como-vender-semijoias-pelo-whatsapp": { title: "Como Vender Semijoias pelo WhatsApp | Lardan" },
  "/privacidade": { description: "Saiba como a Lardan trata dados de contato e candidatura a consultora, para quais finalidades e como exercer seus direitos previstos na LGPD." },
  "/perguntas-sobre-revenda-de-semijoias": { description: "Tire dúvidas sobre revenda de semijoias: consignado ou atacado, maleta, acerto, garantia, MEI, WhatsApp e como ser Consultora Lardan." },
  "/colecoes": { description: "Coleções de semijoias Lardan: acompanhe esta página para conhecer a curadoria editorial e os produtos reais quando forem publicados pela equipe." },
  "/cuidados": { description: "Cuidados com suas semijoias LARDAN: consulte o manual de uso, limpeza e armazenamento e as orientações para a garantia de dois anos." },
  "/ajuda": { description: "Central de Ajuda Lardan: consulte orientações para aceitar seu convite, entrar no sistema e recuperar o acesso à conta com uma nova senha." },
  "/equipe": { description: "Acesso da equipe Lardan: entre na área da operação, das consultoras ou dos representantes usando seu login autorizado para o sistema." },
  "/minha-conta": { description: "Minha conta Lardan: entre ou crie sua conta de cliente na loja de semijoias e encontre as opções de acesso e recuperação da sua senha." },
  "/carrinho": { description: "Sua sacola Lardan: revise as semijoias escolhidas, ajuste as quantidades, simule o frete e finalize o atendimento com a sua consultora." },
  "/redefinir-senha": { description: "Redefina sua senha Lardan: solicite pelo e-mail cadastrado o link de recuperação e crie uma nova senha para voltar a acessar sua conta." },
};

function limitar(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const prefix = clean.slice(0, max - 1);
  const end = prefix.lastIndexOf(" ");
  return `${prefix.slice(0, end > max * 0.7 ? end : prefix.length).replace(/[ ,;:—|-]+$/, "")}…`;
}

export function seoTexts(opts: { title: string; description: string; path: string }) {
  const override = OVERRIDES[opts.path];
  const title = limitar(override?.title ?? opts.title, 60);
  let description = (override?.description ?? opts.description).replace(/\s+/g, " ").trim();
  // Dynamic catalog/share text stays untouched in storage. Add only factual,
  // context-specific metadata when the editor supplied a very short summary.
  const complemento = opts.path.startsWith("/produto/") || opts.path.startsWith("/semijoias/")
    ? " Consulte as peças de semijoias e as informações publicadas no catálogo oficial da Lardan."
    : " Conheça as semijoias Lardan e consulte as informações desta página no site oficial da marca.";
  if (description.length < 120) description += complemento;
  if (description.length < 120) description += " Site oficial Lardan.";
  return { title, description: limitar(description, 155) };
}