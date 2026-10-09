import * as React from "react";
import { ImageOff } from "lucide-react";
import { capasDasPecas } from "@/lib/fotos-produto.functions";

/**
 * Miniatura da peça em qualquer lista. Junta todos os pedidos da tela
 * num só lote (um pedido por página) e guarda por 50 min.
 * Sem foto, mostra o quadro vazio — nunca uma imagem inventada.
 */
type Chave = { tipo: "p" | "v"; id: string };
const cache = new Map<string, { url: string | null; ate: number }>();
const ouvintes = new Map<string, Set<() => void>>();
let fila: Chave[] = [];
let agendado = false;
const VALIDADE = 50 * 60 * 1000;

function avisar(id: string) {
  ouvintes.get(id)?.forEach((f) => f());
}

async function descarregar() {
  agendado = false;
  const lote = fila;
  fila = [];
  const produtos = [...new Set(lote.filter((c) => c.tipo === "p").map((c) => c.id))];
  const variantes = [...new Set(lote.filter((c) => c.tipo === "v").map((c) => c.id))];
  for (let i = 0; i < Math.max(produtos.length, variantes.length); i += 300) {
    const p = produtos.slice(i, i + 300);
    const v = variantes.slice(i, i + 300);
    let mapa: Record<string, string> = {};
    try {
      mapa = await capasDasPecas({ data: { produtos: p, variantes: v } });
    } catch {
      mapa = {};
    }
    for (const id of [...p, ...v]) {
      cache.set(id, { url: mapa[id] ?? null, ate: Date.now() + VALIDADE });
      avisar(id);
    }
  }
}

function pedir(c: Chave) {
  const atual = cache.get(c.id);
  if (atual && atual.ate > Date.now()) return;
  cache.set(c.id, { url: null, ate: Date.now() + 5000 });
  fila.push(c);
  if (!agendado) {
    agendado = true;
    setTimeout(descarregar, 30);
  }
}

function useCapa(c: Chave | null) {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  const id = c?.id;
  React.useEffect(() => {
    if (!c || !id) return;
    const set = ouvintes.get(id) ?? new Set();
    set.add(force);
    ouvintes.set(id, set);
    pedir(c);
    return () => {
      set.delete(force);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return id ? (cache.get(id)?.url ?? null) : null;
}

const TAMANHOS = { xs: "size-8", sm: "size-10", md: "size-12", lg: "size-20" } as const;

/**
 * Miniatura única da peça para todo o sistema. Só foto real do catálogo;
 * sem foto, o quadro vazio. Imagens feitas por IA foram eliminadas.
 */
export function FotoPeca({
  mediaId,
  productId,
  variantId,
  alt = "",
  size = "sm",
  className,
  vazio,
}: {
  mediaId?: string | null;
  productId?: string | null;
  variantId?: string | null;
  alt?: string;
  size?: keyof typeof TAMANHOS;
  className?: string;
  vazio?: React.ReactNode;
}) {
  const [diretaFalhou, setDiretaFalhou] = React.useState(false);
  React.useEffect(() => setDiretaFalhou(false), [mediaId]);
  const direta = mediaId && !diretaFalhou ? `/api/public/midia/${mediaId}` : null;
  // Se a foto pública falhar, busca pelo caminho interno seguro.
  const chave: Chave | null = direta
    ? null
    : productId
      ? { tipo: "p", id: productId }
      : variantId
        ? { tipo: "v", id: variantId }
        : null;
  const lote = useCapa(chave);
  const url = direta ?? lote;
  const [falhou, setFalhou] = React.useState(false);
  React.useEffect(() => setFalhou(false), [url]);
  const aoFalhar = () => (direta ? setDiretaFalhou(true) : setFalhou(true));
  const cls = className ?? `${TAMANHOS[size]} shrink-0 rounded-[8px] border border-line`;
  if (!url || falhou) {
    if (vazio) return <>{vazio}</>;
    return (
      <div
        className={`${cls} bg-surface-muted grid place-items-center text-ledger-muted`}
        aria-label="Sem foto"
        title="Sem foto"
      >
        <ImageOff className="size-3.5" aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      width={80}
      height={80}
      className={`${cls} bg-surface object-cover`}
      onError={() => setFalhou(true)}
    />
  );
}
