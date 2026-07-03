"use client";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";

export default function LogoutButton() {
  const router = useRouter();
  const t = useT();
  return (
    <a
      className="btn btn-sm btn-ghost"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
    >
      {t("nav.logout")}
    </a>
  );
}
