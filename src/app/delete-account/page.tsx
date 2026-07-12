import Link from "next/link";

// Public account-deletion resource (Google Play data-safety "Delete account URL"
// requirement for apps with account creation). English-only on purpose — Google
// requires an English-language deletion resource; the in-app flow is localized.
// Documents the same hard delete performed by POST /api/auth/delete.
export const metadata = {
  title: "Delete your PBudget account",
  description: "How to permanently delete your PBudget account and all associated data.",
};

export default function DeleteAccountPage() {
  return (
    <div className="card" style={{ maxWidth: 680, margin: "0 auto" }}>
      <h1>Delete your PBudget account</h1>
      <p>
        You can permanently delete your PBudget account and all of its data at any
        time, directly from within the app or on the web. You do not need to contact
        us to do this.
      </p>

      <h2 style={{ fontSize: 18, marginTop: 20 }}>How to delete your account</h2>
      <ol style={{ paddingLeft: 20, lineHeight: 1.7 }}>
        <li>
          Sign in to PBudget — in the app, or on the web at{" "}
          <Link href="/login">pbudget.ppvnx.com/login</Link>.
        </li>
        <li>Open the <strong>Customizations</strong> screen.</li>
        <li>Scroll to the <strong>Billing</strong> section.</li>
        <li>Tap <strong>Delete account</strong>, then tap <strong>Confirm delete</strong>.</li>
      </ol>

      <h2 style={{ fontSize: 18, marginTop: 20 }}>What gets deleted</h2>
      <p>Deleting your account immediately and permanently removes:</p>
      <ul style={{ paddingLeft: 20, lineHeight: 1.7 }}>
        <li>your login and email address;</li>
        <li>every connected bank account and all imported transactions;</li>
        <li>your budgets, categories, vendor rules, splits, and merge history;</li>
        <li>all other records associated with your account.</li>
      </ul>
      <p>
        Your bank connections are revoked at Plaid so no further data is accessed,
        and any active subscription is cancelled at the same time.
      </p>

      <h2 style={{ fontSize: 18, marginTop: 20 }}>Data retention</h2>
      <p>
        This action cannot be undone. We do not retain your personal or financial
        data after deletion, except where a limited retention period is required by
        law — for example, billing and tax records that a payment processor is
        legally required to keep. Any such records are access-restricted and are
        deleted once the required retention period ends.
      </p>

      <p className="muted" style={{ marginTop: 24 }}>
        Questions about deletion? Email{" "}
        <a href="mailto:yuner25699@gmail.com">yuner25699@gmail.com</a>. ·{" "}
        <Link href="/">Back to home</Link>
      </p>
    </div>
  );
}
