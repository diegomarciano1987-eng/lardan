/** Appearance only. Never grants access, fetches data, or includes public pages. */
export function isOperationalGlassPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/") ||
    pathname === "/representante" || pathname === "/pdv" || pathname === "/loja";
}