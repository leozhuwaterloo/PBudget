// Deterministic letter avatar for a vendor: first letter + a hue derived from the
// name, so the same name always looks the same. The bundled brand-icon library
// (icons.generated.ts + getBrandIcon/ICON_SLUGS) was retired when vendors moved
// from icons to links (Google Maps / website).
export function letterAvatar(name: string): { letter: string; hue: number } {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { letter, hue: h };
}
