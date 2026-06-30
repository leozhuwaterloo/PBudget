// Syntactic email validation at the trust boundary (CLAUDE.md). A verification
// step (emailed token) is what actually makes an address trusted — see auth.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const e = email.trim().toLowerCase();
  if (e.length < 3 || e.length > 254) return null;
  if (!EMAIL_RE.test(e)) return null;
  return e;
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string") return null;
  if (password.length < 8 || password.length > 200) return null;
  return password;
}
