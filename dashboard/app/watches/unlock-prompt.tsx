'use client';

/** Inline unlock form (D-02, MGMT-06).
 *
 *  Inline on the watches section, NOT a /login route: an unauthenticated visitor still sees the
 *  full read-only watch list (MGMT-01) — only the management controls are replaced by this form.
 *
 *  The session cookie is httpOnly and therefore unreadable from JavaScript. Lock state is passed
 *  down from the Server Component as a prop; this component never inspects the raw cookie header
 *  (which would always report "locked" and is also exactly the property that keeps the secret out
 *  of reach of injected script — threat T-05-17).
 */
import { useState } from 'react';
import { COPY } from '@/lib/copy';

export function UnlockPrompt({ onUnlocked }: { onUnlocked: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      setPending(false);
      if (res.ok) {
        setPassphrase('');
        onUnlocked();
      } else {
        setError(true);
      }
    } catch {
      setPending(false);
      setError(true);
    }
  }

  return (
    <div className="unlock">
      <h3 className="unlock-heading">{COPY.unlockHeading}</h3>
      <p className="unlock-body">{COPY.unlockBody}</p>
      <form className="unlock-form" onSubmit={handleSubmit}>
        <input
          className="field-input"
          type="password"
          name="passphrase"
          autoComplete="current-password"
          placeholder={COPY.unlockPlaceholder}
          aria-label={COPY.unlockPlaceholder}
          value={passphrase}
          onChange={(e) => {
            setPassphrase(e.target.value);
            setError(false);
          }}
        />
        <button
          className="btn btn--primary"
          type="submit"
          disabled={pending || passphrase.length === 0}
        >
          {COPY.unlockSubmit}
        </button>
      </form>
      {error ? (
        <p className="field-error" role="alert">
          {COPY.unlockError}
        </p>
      ) : null}
    </div>
  );
}
