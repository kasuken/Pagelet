import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { ErrorNotice } from './ErrorNotice';
import { Field } from './Field';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  /** When set, the person must type this word exactly before confirming. */
  typedWord?: string;
  /** When set, a reason (3–300 characters) is required and passed to onConfirm. */
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<void>;
  destructive?: boolean;
}

export function ConfirmDialog({ open, onClose, title, children, confirmLabel, busyLabel, typedWord, reasonLabel, onConfirm }: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reasonError, setReasonError] = useState<string>();

  useEffect(() => {
    if (open) {
      setTyped('');
      setReason('');
      setError(null);
      setReasonError(undefined);
    }
  }, [open]);

  const wordOk = !typedWord || typed.trim() === typedWord;

  async function confirm() {
    if (reasonLabel) {
      const r = reason.trim();
      if (r.length < 3 || r.length > 300) {
        setReasonError('Write a reason between 3 and 300 characters.');
        return;
      }
    }
    if (!wordOk) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      closeLabel={`Cancel: ${title}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={confirm} busy={busy} busyLabel={busyLabel} disabled={!wordOk}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="confirm-dialog">
        {children}
        {reasonLabel ? (
          <Field label={reasonLabel} value={reason} error={reasonError} maxLength={300} onChange={(e) => { setReason(e.target.value); setReasonError(undefined); }} description="Saved in the audit trail." />
        ) : null}
        {typedWord ? (
          <Field label={`Type ${typedWord} to confirm`} value={typed} autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
        ) : null}
        {error ? <ErrorNotice title="That did not work" error={error} /> : null}
      </div>
    </Dialog>
  );
}
