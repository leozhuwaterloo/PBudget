import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import ResendButton from "@/components/ResendButton";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams?.token;

  if (token) {
    const row = await prisma.emailVerificationToken.findUnique({ where: { token } });
    if (row && row.expiresAt > new Date()) {
      await prisma.user.update({ where: { id: row.userId }, data: { emailVerified: new Date() } });
      await prisma.emailVerificationToken.deleteMany({ where: { userId: row.userId } });
      return (
        <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
          <h1>Email verified ✓</h1>
          <p className="muted">Your account is now active.</p>
          <Link className="btn btn-primary" href="/dashboard">Go to dashboard</Link>
        </div>
      );
    }
    return (
      <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
        <h1>Link invalid or expired</h1>
        <p className="muted">Request a fresh verification link below.</p>
        <ResendButton />
      </div>
    );
  }

  const user = await getSessionUser();
  if (user?.emailVerified) {
    return (
      <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
        <h1>You&apos;re verified ✓</h1>
        <Link className="btn btn-primary" href="/dashboard">Go to dashboard</Link>
      </div>
    );
  }
  return (
    <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
      <h1>Verify your email</h1>
      <p className="muted">
        We sent a verification link to {user?.email ?? "your inbox"}. Click it to activate your
        account. (In local dev, the link is printed to the server console.)
      </p>
      <ResendButton />
    </div>
  );
}
