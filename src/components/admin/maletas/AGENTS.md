# Maletas e remessas
- Remessa (table remessas, unique numero, one praça) is the parent of maletas: kit_cycles.remessa_id, opened only via remessa_abrir_maleta (consultant must belong to the remessa's praça, one maleta per consultant per remessa); print docs read número/praça/acerto from the remessa. Why: remessa is the master control entity.
