/** 0299 — botões do painel "Baixa no Lardan → Asaas". */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = (f: string, a: object) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Ctx = {
  supabase: {
    rpc: Rpc;
    from: (t: string) => {
      select: (c: string) => {
        eq: (k: string, v: string) => {
          order: (k: string, o: { ascending: boolean }) => { limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> };
        };
      };
    };
  };
  userId: string;
};

async function exigir(c: Ctx) {
  const pode = await c.supabase.rpc("asaas_ator_pode", { _actor: c.userId, _cap: "finance.receivable.manage" });
  if (pode.error || !pode.data) throw new Error("Sem acesso ao financeiro.");
}

export const sincronizarSaldosAgora = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = context as unknown as Ctx;
    await exigir(c);
    const { sincronizarSaldosProducao } = await import("./saldo.server");
    return sincronizarSaldosProducao(30);
  });

export const decidirSaldo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; decisao: "substituir" | "ignorar" | "tentar"; motivo: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(d?.id ?? "")) throw new Error("Tarefa inválida.");
    if (!["substituir", "ignorar", "tentar"].includes(d.decisao)) throw new Error("Decisão inválida.");
    if ((d.motivo ?? "").trim().length < 5) throw new Error("Informe o motivo (mínimo 5 letras).");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigir(c);
    const r = await c.supabase.rpc("asaas_saldo_decidir", { _job: data.id, _decisao: data.decisao, _motivo: data.motivo.trim() });
    if (r.error) throw new Error(r.error.message);
    if (data.decisao === "ignorar") return { ok: true, sync: null };
    const { sincronizarSaldosProducao } = await import("./saldo.server");
    return { ok: true, sync: await sincronizarSaldosProducao(10) };
  });

/** 0303 — "Levar o Lardan ao Asaas": pede o espelho de vencimento/valor de uma parcela e roda a rotina na hora. */
export const espelharParcelaAgora = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { installmentId: string; motivo: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(d?.installmentId ?? "")) throw new Error("Parcela inválida.");
    if ((d.motivo ?? "").trim().length < 5) throw new Error("Informe o motivo (mínimo 5 letras).");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigir(c);
    const r = await c.supabase.rpc("asaas_espelho_pedir", { _inst: data.installmentId, _motivo: data.motivo.trim() });
    if (r.error) throw new Error(r.error.message);
    const { sincronizarSaldosProducao } = await import("./saldo.server");
    const sync = await sincronizarSaldosProducao(10);
    const t = await c.supabase.from("asaas_saldo_sync").select("estado, motivo, erro").eq("installment_id", data.installmentId)
      .order("created_at", { ascending: false }).limit(1);
    const ult = (t.data?.[0] ?? null) as { estado: string; motivo: string; erro: string | null } | null;
    return { ok: true, processadas: sync.processadas, tarefa: ult };
  });
