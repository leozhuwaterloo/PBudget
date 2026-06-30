import nodemailer from "nodemailer";

// If SMTP isn't configured (local dev), we just log the link to the server
// console instead of sending — keeps dev frictionless, no dependency on a
// mail provider. Wire SMTP_* in prod (creds via Vault).
function transport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const url = `${process.env.APP_URL || "http://localhost:5300"}/verify?token=${token}`;
  const t = transport();
  if (!t) {
    console.log(`\n[email] Verify ${to}: ${url}\n`);
    return;
  }
  await t.sendMail({
    from: process.env.EMAIL_FROM || "PlaidBudget <no-reply@plaidbudget.local>",
    to,
    subject: "Verify your PlaidBudget email",
    text: `Confirm your email by opening: ${url}`,
    html: `<p>Confirm your email to start using PlaidBudget.</p><p><a href="${url}">Verify my email</a></p>`,
  });
}
