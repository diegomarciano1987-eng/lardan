# PDV

- PDV terminals enter by store number + password (bcrypt) + team member e-mail + 6-digit e-mailed code (bcrypt, 10 min, 5 tries) and keep only a token hash in an httpOnly cookie; sellers switch by per-member PIN, and every PDV operation runs through service_role-only pdv_* RPCs that re-check price, discount limit, stock, cash register and commission. Why: shared store device without exposing tables or trusting client prices.
- Only active internal sellers (party role vendedora_interna, ficha in vendedora_profiles, login linked via profiles.party_id) may join a PDV team that sells; enforced by trigger on pdv_membros. Why: keep consultants, clients and back-office out of store cash registers.
