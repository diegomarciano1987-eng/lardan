export const NAV_ITEMS = [
  { label: "A Lardan", to: "/a-lardan" },
  { label: "Semijoias", to: "/semijoias" },
  { label: "Coleção", to: "/colecoes" },
  { label: "Seja Lardan", to: "/seja-lardan" },
  { label: "Contato", to: "/contato" },
] as const;

export const BRAND = {
  name: "LARDAN",
  tagline: "Única. Como cada história.",
  subline: "Semijoias para acompanhar os seus momentos.",
} as const;

/** Canal oficial confirmado pela marca. */
export const INSTAGRAM_URL = "https://www.instagram.com/lardanoficial/";

/**
 * Redes oficiais da Lardan. Só entram aqui canais realmente da marca —
 * nada é inventado. Novas redes confirmadas basta adicionar nesta lista.
 */
export const SOCIALS = [
  { icone: "instagram", rotulo: "Instagram da Lardan", href: INSTAGRAM_URL },
] as const;
