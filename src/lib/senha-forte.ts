/** Senha forte e fácil de ditar: Palavra + Palavra + 4 dígitos (ex.: BrincoLua4827). Aleatória via crypto. */
const PALAVRAS = [
  "Brinco", "Colar", "Anel", "Perola", "Dourado", "Prata", "Lua", "Sol", "Estrela", "Flor",
  "Rosa", "Cristal", "Brilho", "Coral", "Jade", "Ambar", "Safira", "Opala", "Topazio", "Rubi",
  "Aurora", "Oceano", "Cereja", "Canela", "Menta", "Violeta", "Lirio", "Orquidea", "Trevo", "Cometa",
];

function aleatorio(max: number) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! % max;
}

export function gerarSenhaForte() {
  const p1 = PALAVRAS[aleatorio(PALAVRAS.length)]!;
  let p2 = PALAVRAS[aleatorio(PALAVRAS.length)]!;
  while (p2 === p1) p2 = PALAVRAS[aleatorio(PALAVRAS.length)]!;
  const num = String(1000 + aleatorio(9000));
  return `${p1}${p2}${num}`;
}

/** Traduz o recado do serviço de login quando a senha é conhecida/vazada. */
export function traduzirErroSenha(msg: string) {
  if (/weak|easy to guess|pwned|leaked/i.test(msg))
    return "Esta senha é muito conhecida (aparece em listas de senhas vazadas). Use o botão “Gerar senha forte” ou escolha outra.";
  return msg;
}
