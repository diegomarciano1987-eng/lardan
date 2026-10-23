# Fiscal / Focus NFe rules
- Fiscal results (attempt/authorization/rejection/homologated cancellation): service_role only (db/pendentes/11). Authorization requires nfe_chave_valida with emitter CNPJ; model/series/number from key. Why: no manual authorization.
- fiscal_settings emission/provider/environment/emitter changes: Master only, provider+emitter+environment required before activation, disable before environment change, audit fiscal.configuracao_alterada. Why: controlled fiscal switch.
- fiscal_prontidao: counts only, no personal data. Why: privacy.
- Focus NFe (0118): homologação only; fiscal_focus_* writes are service_role (server fns check fiscal_focus_pode first); payload from src/lib/focus/nfe.ts roteiro (5917/1918/5114/5927, CSOSN 102, 1/3 retail) — never change roteiro to dodge a SEFAZ rejection; tokens/secrets only in Lovable secrets. Why: fiscal safety.
