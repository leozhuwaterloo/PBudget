// Instant loading UI for the dashboard. It's force-dynamic and the server
// aggregate (all transactions, decrypted) can take a moment for a heavy account,
// so show a skeleton the instant login navigates here instead of hanging on the
// previous page. Language-neutral (no copy) since this is a server boundary.
export default function DashboardLoading() {
  return (
    <div aria-busy="true">
      <div className="skeleton" style={{ height: 30, width: 200, marginBottom: 22 }} />
      <div className="stat-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 92 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 260, marginTop: 18 }} />
    </div>
  );
}
