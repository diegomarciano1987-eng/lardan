# Segurança das portas públicas

- Public write doors (candidatura, contato, vitrine purchase, colab login) are throttled server-side via service-only seguranca_limite; limite.server reads the Cloudflare IP from headers and fails open. Why: no mass submissions or spoofed IPs, never take the site down.
- The anon SECURITY DEFINER whitelist, RLS on every table and no definer views are guarded by tests/isolado/seguranca-0326; opening a new anon routine means updating that list on purpose. Why: no silent public doors.
