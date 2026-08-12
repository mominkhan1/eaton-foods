import { useCallback, useState } from 'react';

/**
 * Run one admin write, tracking whether it is in flight and what went wrong.
 *
 * Every edit in the panel is now a network call that can be refused — by
 * validation, by a permission the signed-in user does not have, or by the shop
 * wifi dropping mid-service. Before, these were local writes that could not
 * fail, so the screens had nowhere to put an error. This gives them one place.
 *
 * The API's messages are already written for a person to read, so they are
 * surfaced as-is rather than translated again here.
 */
export function useAdminAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async (work) => {
    setBusy(true);
    setError(null);

    try {
      const result = await work();
      return { ok: true, result };
    } catch (caught) {
      setError(caught?.message ?? 'That change could not be saved.');
      return { ok: false, error: caught };
    } finally {
      setBusy(false);
    }
  }, []);

  return { run, busy, error, setError };
}
