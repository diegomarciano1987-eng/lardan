/** Formatting only: preserve approved prose and give each cited page a readable link. */
const PAGES: Record<string, [string, string]> = {
  "/": ["Site oficial da Lardan", "Apresentação da marca e acesso ao conteúdo público."],
  "/a-lardan": ["A Lardan", "História, fundadores e valores da empresa."],
  "/seja-lardan": ["Seja Lardan", "Oportunidade e candidatura para ser Consultora Lardan."],
  "/semijoias": ["Catálogo de semijoias", "Catálogo público de semijoias Lardan."],
  "/semijoias/brincos": ["Brincos", "Categoria de brincos no catálogo público."],
  "/semijoias/colares": ["Colares", "Categoria de colares no catálogo público."],
  "/semijoias/pulseiras": ["Pulseiras", "Categoria de pulseiras no catálogo público."],
  "/semijoias/aneis": ["Anéis", "Categoria de anéis no catálogo público."],
  "/colecoes": ["Coleções", "Página pública de coleções."],
  "/contato": ["Contato", "Formulário de contato e endereço da Lardan."],
  "/privacidade": ["Aviso de privacidade", "Informações públicas sobre privacidade."],
  "/renda-extra-com-vendas": ["Renda extra com vendas", "Como avaliar vendas como possibilidade de renda adicional."],
  "/como-comecar-a-vender-semijoias": ["Como começar a vender semijoias", "Orientações para iniciar a venda de semijoias."],
  "/semijoias-consignadas-para-revenda": ["Semijoias consignadas para revenda", "Funcionamento, responsabilidades e perguntas sobre consignação."],
  "/como-vender-semijoias-pelo-whatsapp": ["Como vender semijoias pelo WhatsApp", "Relacionamento, atendimento e venda pelo WhatsApp."],
  "/perguntas-sobre-revenda-de-semijoias": ["Perguntas sobre revenda de semijoias", "Dúvidas sobre maleta, acerto, ganhos e formalização."],
  "/como-cuidar-de-semijoias": ["Como cuidar de semijoias", "Limpeza, armazenamento, alergias e garantia."],
  "/semijoia-folheado-ou-bijuteria": ["Semijoia, folheado ou bijuteria", "Diferenças e critérios para avaliar uma peça antes de comprar."],
};

export function formatLlmsLinks(document: string): string {
  return document.replace(/^(.*?)(https:\/\/[^\s]+)\s*$/gm, (line, prefix: string, href: string) => {
    // Already-formatted links are never rewritten.
    if (prefix.includes("](")) return line;
    const url = new URL(href);
    const page = url.hostname === "www.instagram.com"
      ? ["Instagram oficial da Lardan", "Perfil oficial da marca no Instagram."]
      : PAGES[url.pathname || "/"];
    if (!page) throw new Error(`Página citada sem descrição: ${url.pathname}`);
    return `${prefix.trim() ? `${prefix.trim()}\n` : ""}- [${page[0]}](${href}): ${page[1]}`;
  });
}