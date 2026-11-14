import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Accessible name for the close button. */
  closeLabel?: string;
  footer?: ReactNode;
}

/**
 * Modal built on the native <dialog>: focus is trapped by the browser, Escape closes it,
 * and focus returns to whatever opened it.
 */
export function Dialog({ open, onClose, title, children, closeLabel = 'Close', footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => {
      const target = returnFocusTo.current;
      returnFocusTo.current = null;
      if (target?.isConnected) target.focus();
      onClose();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId}>
      <div className="dialog__header">
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        <button type="button" className="dialog__close" onClick={() => ref.current?.close()}>
          <span aria-hidden="true">×</span>
          <span className="visually-hidden">{closeLabel}</span>
        </button>
      </div>
      <div className="dialog__body">{children}</div>
      {footer ? <div className="dialog__footer">{footer}</div> : null}
    </dialog>
  );
}
