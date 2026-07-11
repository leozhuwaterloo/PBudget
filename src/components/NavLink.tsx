"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// One left-rail item: icon + label, highlighted when its route is active. Kept as
// a client component so it can read the current path; the layout passes a stable
// icon key + already-localized label so nothing here needs i18n.
type IconName = "dashboard" | "review" | "accounts" | "vendors" | "customizations";

// Lucide-style stroke glyphs (currentColor so the active pill tints them).
const ICONS: Record<IconName, React.ReactNode> = {
  dashboard: (
    <path d="M3 10.5 12 4l9 6.5M5 9.5V20h5v-6h4v6h5V9.5" />
  ),
  review: (
    <>
      <path d="M4 5h16v10.5a1.5 1.5 0 0 1-1.5 1.5H14l-2 2-2-2H5.5A1.5 1.5 0 0 1 4 15.5Z" />
      <path d="m8.5 10.5 2 2 4-4" />
    </>
  ),
  accounts: (
    <>
      <path d="m12 3 9 4.5-9 4.5-9-4.5Z" />
      <path d="m3 12 9 4.5 9-4.5" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </>
  ),
  vendors: (
    <>
      <path d="M4 4h6l9.5 9.5a2 2 0 0 1 0 2.8l-3.2 3.2a2 2 0 0 1-2.8 0L4 10Z" />
      <circle cx="8.5" cy="8.5" r="1.4" />
    </>
  ),
  customizations: (
    <>
      <path d="M4 7h11M4 12h16M4 17h8" />
      <circle cx="17.5" cy="7" r="2" />
      <circle cx="15.5" cy="17" r="2" />
    </>
  ),
};

export default function NavLink({ href, label, icon }: { href: string; label: string; icon: IconName }) {
  const path = usePathname();
  const active = path === href || path?.startsWith(href + "/");
  return (
    <Link href={href} className={active ? "nav-link active" : "nav-link"} aria-current={active ? "page" : undefined}>
      <span className="nav-ic" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
          {ICONS[icon]}
        </svg>
      </span>
      <span>{label}</span>
    </Link>
  );
}
