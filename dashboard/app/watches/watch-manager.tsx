'use client';

/** The watch-management surface (MGMT-01/MGMT-04/MGMT-06).
 *
 *  Client component with the watch array in React state, seeded from the Server Component's
 *  already-parsed watches prop. Mutations update this local array directly rather than triggering
 *  a server-driven page refresh: page.tsx reads watches.json through raw.githubusercontent.com's
 *  CDN behind a 30s Data Cache window, so a refresh right after a commit would very likely
 *  re-render the PRE-edit file and look like the save silently failed (D-12's "live within ~5 min"
 *  copy is about the poller cron; this is a second, separate propagation delay on the read path).
 *
 *  `unlocked` arrives as a prop from the server, never read client-side from the cookie jar — the
 *  session cookie is httpOnly and unreadable here by design.
 */
import { useEffect, useRef, useState } from 'react';
import { COPY } from '@/lib/copy';
import type { Watch } from '@/lib/types';
import { formatWatchLocation, formatWatchDates, formatSiteType, formatWatchKind } from '@/lib/format-watch';
import { UnlockPrompt } from './unlock-prompt';
import { WatchForm } from './watch-form';

export function WatchManager({
  watches: initialWatches,
  unlocked: initialUnlocked,
}: {
  watches: Watch[];
  unlocked: boolean;
}) {
  const [watches, setWatches] = useState(initialWatches);
  const [unlocked, setUnlocked] = useState(initialUnlocked);
  const [pendingDelete, setPendingDelete] = useState<Watch | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  /** null while creating; the watch being edited otherwise. */
  const [editing, setEditing] = useState<Watch | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (pendingDelete) confirmRef.current?.showModal();
    else confirmRef.current?.close();
  }, [pendingDelete]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/watches/${encodeURIComponent(pendingDelete.id)}`, {
        method: 'DELETE',
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && body.ok) {
        setWatches((prev) => prev.filter((w) => w.id !== pendingDelete.id));
        setToast(COPY.deletedToast);
      } else if (res.status === 401) {
        setUnlocked(false); // the ~30d cookie expired mid-session
        setError(COPY.unlockHeading);
      } else {
        setError(COPY.saveFailed.replace('{reason}', body.error ?? ''));
      }
    } catch {
      setError(COPY.saveFailed.replace('{reason}', ''));
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  }

  async function handleSave(watch: Watch) {
    setBusy(true);
    setFormError(null);
    const isEdit = editing !== null;
    const url = isEdit ? `/api/watches/${encodeURIComponent(editing.id)}` : '/api/watches';
    try {
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(watch),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && body.ok) {
        setWatches((prev) =>
          isEdit ? prev.map((w) => (w.id === editing.id ? watch : w)) : [...prev, watch]
        );
        setFormOpen(false);
        setEditing(null);
        setToast(COPY.savedToast);
      } else if (res.status === 401) {
        setUnlocked(false); // the ~30d cookie expired mid-session
        setFormOpen(false);
        setError(COPY.unlockHeading);
      } else {
        // Modal STAYS OPEN with the reason visible: closing it would discard everything the user
        // typed on a recoverable failure like a duplicate id (409) or a validation error (400).
        setFormError(COPY.saveFailed.replace('{reason}', body.error ?? ''));
      }
    } catch {
      setFormError(COPY.saveFailed.replace('{reason}', ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section" aria-label={COPY.sectionManageWatches}>
      <div className="manage-header">
        <h2 className="section-heading">{COPY.sectionManageWatches}</h2>
        {unlocked ? (
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => {
              setEditing(null);
              setFormError(null);
              setFormOpen(true);
            }}
          >
            {COPY.addWatch}
          </button>
        ) : null}
      </div>

      {!unlocked ? <UnlockPrompt onUnlocked={() => setUnlocked(true)} /> : null}

      {watches.length === 0 ? (
        <div>
          <p className="empty-heading">{COPY.emptyWatchesHeading}</p>
          <p className="empty-body">{COPY.emptyWatchesBody}</p>
        </div>
      ) : (
        <ul className="rows">
          {watches.map((w) => (
            <li className="row" key={w.id}>
              <div>
                <div className="row-main">{formatWatchLocation(w)}</div>
                <div className="row-meta">
                  {formatWatchKind(w)} · {formatWatchDates(w)} · {formatSiteType(w.siteType)}
                </div>
              </div>
              {unlocked ? (
                <>
                  <button
                    className="btn btn--icon"
                    type="button"
                    aria-label={COPY.editWatchLabel.replace('{watch}', w.id)}
                    onClick={() => {
                      setEditing(w);
                      setFormError(null);
                      setFormOpen(true);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="btn btn--icon btn--destructive"
                    type="button"
                    aria-label={COPY.deleteWatchLabel.replace('{watch}', w.id)}
                    onClick={() => setPendingDelete(w)}
                  >
                    ×
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      <WatchForm
        open={formOpen}
        initial={editing}
        submitting={busy}
        serverError={formError}
        onSubmit={handleSave}
        onCancel={() => {
          setFormOpen(false);
          setEditing(null);
          setFormError(null);
        }}
      />

      <dialog
        className="dialog dialog--confirm"
        ref={confirmRef}
        onClose={() => setPendingDelete(null)}
      >
        <p className="dialog-heading">{COPY.deleteConfirm}</p>
        <div className="dialog-actions">
          <button
            className="btn btn--ghost"
            type="button"
            onClick={() => confirmRef.current?.close()}
          >
            {COPY.deleteConfirmNo}
          </button>
          <button
            className="btn btn--destructive"
            type="button"
            disabled={busy}
            onClick={handleDelete}
          >
            {COPY.deleteConfirmYes}
          </button>
        </div>
      </dialog>

      {toast ? (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      ) : null}
    </section>
  );
}
