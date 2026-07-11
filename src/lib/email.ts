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

export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  const t = transport();
  if (!t) {
    console.log(`\n[email] Verify ${to}: code ${code} (expires in 30 minutes)\n`);
    return;
  }
  await t.sendMail({
    from: process.env.EMAIL_FROM || "PBudget <no-reply@pbudget.local>",
    to,
    subject: "Your PBudget verification code",
    text: `Your PBudget verification code is ${code}. It expires in 30 minutes.`,
    html: `<p>Your PBudget verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>It expires in 30 minutes. Enter it on the verification page to activate your account.</p>`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const url = `${process.env.APP_URL || "http://localhost:5300"}/reset?token=${token}`;
  const t = transport();
  if (!t) {
    console.log(`\n[email] Reset ${to}: ${url}\n`);
    return;
  }
  await t.sendMail({
    from: process.env.EMAIL_FROM || "PBudget <no-reply@pbudget.local>",
    to,
    subject: "Reset your PBudget password",
    text: `Reset your password by opening: ${url} — this link expires in 1 hour. If you didn't request this, ignore this email.`,
    html: `<p>Reset your PBudget password. This link expires in 1 hour.</p><p><a href="${url}">Reset my password</a></p><p>If you didn't request this, you can ignore this email.</p>`,
  });
}
