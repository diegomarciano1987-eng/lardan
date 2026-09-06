/**
 * Ponte entre as telas e os provedores públicos. Tudo autenticado: o navegador
 * nunca fala com CEP/CNPJ/IBGE diretamente e nunca escolhe a URL consultada.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const consultarCep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ cep: z.string().max(12) }).parse(data))
  .handler(async ({ data, context }) => {
    const { lookupAddressByPostalCode } = await import("./providers.server");
    return lookupAddressByPostalCode(data.cep, context.userId ?? null);
  });

export const consultarCnpj = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ cnpj: z.string().max(20), comQsa: z.boolean().default(false) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { lookupCompanyByTaxId } = await import("./providers.server");
    // O quadro societário é dado pessoal de terceiros: só sai com permissão.
    let comQsa = false;
    if (data.comQsa) {
      const { data: autorizado } = await context.supabase.rpc("has_capability", {
        _user_id: context.userId,
        _cap: "registry.doc.view",
      });
      comQsa = autorizado === true;
    }
    return lookupCompanyByTaxId(data.cnpj, context.userId ?? null, { comQsa });
  });

export const listarMunicipios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ uf: z.string().length(2) }).parse(data))
  .handler(async ({ data, context }) => {
    const { listMunicipalitiesByState } = await import("./providers.server");
    return listMunicipalitiesByState(data.uf, context.userId ?? null);
  });
