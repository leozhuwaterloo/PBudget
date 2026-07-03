import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";

export const metadata: Metadata = {
  title: "PBudget",
  description: "Personal budgeting backed by Plaid",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link href="/" className="brand">PBudget</Link>
          <div className="spacer" />
          {user ? (
            <>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/review">Review</Link>
              <Link href="/report">Report</Link>
              <Link href="/budget">Budget</Link>
              <Link href="/settings/categories">Categories</Link>
              <Link href="/billing">Billing</Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/signup">Sign up</Link>
            </>
          )}
        </nav>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
