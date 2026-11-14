import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Field } from '../../components/Field';
import { RadioGroup } from '../../components/FormControls';
import { Notice } from '../../components/Notice';
import { decimalToMinor, formatMoney, minorToDecimal } from '../../lib/money';
import type { OwnerProductDetail } from '../../lib/types';
import { issuesByPath, StaleNotice, StaleRevisionError } from '../common';
import { saveProduct } from './saveProduct';

interface Props {
  product: OwnerProductDetail;
  readOnly: boolean;
  onSaved: (product: OwnerProductDetail) => void;
  onReload: () => void;
  onDirty: (dirty: boolean) => void;
}

export function PricingTab({ product, readOnly, onSaved, onReload, onDirty }: Props) {
  const currency = product.price.currency;
  const initial = useMemo(() => ({ price: currency ? minorToDecimal(product.price.amountMinor, currency) : '', updatePolicy: product.updatePolicy }), [product, currency]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [priceError, setPriceError] = useState<string>();
  const [saved, setSaved] = useState(false);
  // Reset only when the saved values change, not on every reload of the same data (publish polling, uploads, reorders).
  const initialKey = JSON.stringify(initial);
  useEffect(() => setForm(JSON.parse(initialKey) as typeof initial), [initialKey]);
  const dirty = form.price !== initial.price || form.updatePolicy !== initial.updatePolicy;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  if (!currency) {
    return (
      <Notice tone="danger" title="Set the shop currency first">
        <p>Prices are stored in the shop currency. Choose it in Settings, then come back to set the price.</p>
      </Notice>
    );
  }

  const parsed = decimalToMinor(form.price, currency);
  const issues = issuesByPath(error);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (parsed === null) {
      setPriceError(`Enter a price like ${minorToDecimal(4900, currency)}, or 0 for a free product.`);
      return;
    }
    setPriceError(undefined);
    setBusy(true);
    setError(null);
    setSaved(false);
    const changes: Record<string, unknown> = {};
    if (form.price !== initial.price) changes.priceMinor = parsed;
    if (form.updatePolicy !== initial.updatePolicy) changes.updatePolicy = form.updatePolicy;
    try {
      onSaved(await saveProduct(product, changes));
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="editor">
      {error instanceof StaleRevisionError ? <StaleNotice error={error} onReload={onReload} /> : null}
      <form className="stack" onSubmit={submit} noValidate>
        <Field
          label={`Price in ${currency}`}
          description={parsed === 0 ? 'Free: visitors claim it with their email instead of paying.' : parsed !== null ? `Shown as ${formatMoney({ amountMinor: parsed, currency })}. Use 0 for a free product.` : 'Use 0 for a free product.'}
          inputMode="decimal"
          className="field--narrow"
          value={form.price}
          disabled={readOnly}
          error={priceError ?? issues.priceMinor}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
        />
        <RadioGroup
          legend="When you publish changes"
          name="updatePolicy"
          value={form.updatePolicy}
          onChange={(v) => setForm({ ...form, updatePolicy: v })}
          options={[
            { value: 'latest', label: 'Buyers get the latest version', description: 'Everyone who bought it sees your updates after each publish.' },
            { value: 'pinned', label: 'Buyers keep the version they bought', description: 'New buyers get the new version; earlier buyers keep theirs.' },
          ]}
        />
        <p className="field__description">Changing the price affects new purchases only. Existing orders keep the price that was paid.</p>
        <div className="form-actions">
          <Button type="submit" disabled={!dirty || readOnly} busy={busy} busyLabel="Saving…">Save pricing</Button>
          {dirty ? <span className="form-actions__note">Unsaved changes</span> : null}
          <p className="save-status" role="status">{saved && !dirty ? 'Saved' : ''}</p>
        </div>
        {error && !(error instanceof StaleRevisionError) ? <ErrorNotice title="Pricing was not saved" error={error} /> : null}
      </form>
    </div>
  );
}
