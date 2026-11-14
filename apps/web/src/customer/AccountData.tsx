import { useState } from 'react';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { api } from '../lib/api';

/** L04: download your own data, or erase your account (orders are kept without your identity). */
export function AccountData({ onErased }: { onErased: () => void }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const [eraseOpen, setEraseOpen] = useState(false);

  async function exportData() {
    setExporting(true);
    setExportError(null);
    try {
      const data = await api<unknown>('/api/me/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  }

  return (
    <section aria-labelledby="data-title" className="customer__section">
      <h2 id="data-title" className="customer__section-title">Your data</h2>
      <p className="customer__empty">Download a copy of your purchases, receipts and progress, or delete your account.</p>
      <div className="page-message__actions customer__actions">
        <Button variant="secondary" busy={exporting} busyLabel="Preparing your data…" onClick={exportData}>Download my data</Button>
        <Button variant="secondary" onClick={() => setEraseOpen(true)}>Delete my account</Button>
      </div>
      {exportError ? <ErrorNotice title="Your data could not be downloaded" error={exportError} /> : null}
      <ConfirmDialog
        open={eraseOpen}
        onClose={() => setEraseOpen(false)}
        title="Delete your account?"
        confirmLabel="Delete my account"
        busyLabel="Deleting…"
        typedWord="DELETE"
        destructive
        onConfirm={async () => {
          await api('/api/me/erase', { method: 'POST', body: { confirm: 'DELETE' } });
          onErased();
        }}
      >
        <p>
          You lose access to everything you bought from this shop, on every device, and your progress is removed.
          Order records stay for the shop’s accounts, without your email address. This cannot be undone.
        </p>
      </ConfirmDialog>
    </section>
  );
}
