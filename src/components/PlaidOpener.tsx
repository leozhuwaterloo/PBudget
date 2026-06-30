"use client";
import { useEffect } from "react";
import { usePlaidLink } from "react-plaid-link";

// Mounts with a link token and immediately opens Plaid Link. Used for both the
// initial connect flow and update-mode re-auth.
export default function PlaidOpener({
  token,
  onSuccess,
  onExit,
}: {
  token: string;
  onSuccess: (publicToken: string) => void;
  onExit: () => void;
}) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (publicToken) => onSuccess(publicToken),
    onExit: () => onExit(),
  });
  useEffect(() => {
    if (ready) open();
  }, [ready, open]);
  return null;
}
