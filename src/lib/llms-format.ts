/** Formatting only: preserve approved prose and give each cited page a readable link. */
const PAGES: Record<string, [string, string]> = {
  "/": ["Site oficial da Lardan", "Apresentação da marca."],
  "/a-lardan": ["A Lardan", "História e fundadores."],
  "/seja-lardan": ["Seja Lardan", "Candidatura."],
  "/semijoias": ["Catálogo de semijoias", "Catálogo público."],
  "/semijoias/brincos": ["Brincos", "Catálogo de brincos."],
  "/semijoias/colares": ["Colares", "Catálogo de colares."],
  "/semijoias/pulseiras": ["Pulseiras", "Catálogo de pulseiras."],
  "/semijoias/aneis": ["Anéis", "Catálogo de anéis."],
  "/colecoes": ["Coleções", "Página de coleções."],
  "/contato": ["Contato", "Formulário e endereço."],
  "/privacidade": ["Aviso de privacidade", "Privacidade."],
  "/renda-extra-com-vendas": ["Renda extra com vendas", "Renda adicional."],
  "/como-comecar-a-vender-semijoias": ["Como começar a vender semijoias", "Início das vendas."],
  "/semijoias-consignadas-para-revenda": ["Semijoias consignadas para revenda", "Regras da consignação."],
  "/como-vender-semijoias-pelo-whatsapp": ["Como vender semijoias pelo WhatsApp", "Vendas pelo WhatsApp."],
  "/perguntas-sobre-revenda-de-semijoias": ["Perguntas sobre revenda de semijoias", "Dúvidas sobre revenda."],
  "/como-cuidar-de-semijoias": ["Como cuidar de semijoias", "Cuidados e garantia."],
  "/guia/semijoia-folheado-ou-bijuteria": ["Semijoia, folheado ou bijuteria", "Materiais e diferenças."],
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