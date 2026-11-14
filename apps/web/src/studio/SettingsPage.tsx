import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { Field } from '../components/Field';
import { CheckboxField, ErrorSummary, RadioGroup, SelectField, TextAreaField } from '../components/FormControls';
import { MoveButtons, moveItem } from '../components/MoveButtons';
import { Notice } from '../components/Notice';
import { Skeleton } from '../components/Skeleton';
import { api } from '../lib/api';
import { contrastRatio } from '../lib/contrast';
import { HEX_COLOR } from '../lib/patterns';
import type { ContactLinkValue, OwnerProduct, OwnerShopResponse, OwnerShopSettings, TaxMode } from '../lib/types';
import { useApiResource } from '../lib/useApi';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { issuesByPath, StudioHeading, useUnsavedWarning } from './common';
import { Uploader } from './media/Uploader';
import { requirementLabel } from './requirements';

interface Form {
  shopName: string;
  currency: string;
  timezone: string;
  accentHex: string;
  creatorName: string;
  creatorBio: string;
  introduction: string;
  featuredProductId: string;
  contactLinks: ContactLinkValue[];
  legalName: string;
  address: string;
  contactEmail: string;
  vatId: string;
  terms: string;
  privacy: string;
  refund: string;
  taxMode: TaxMode;
  logoAlt: string;
  acceptConsent: boolean;
}

function toForm(s: OwnerShopSettings | null): Form {
  return {
    shopName: s?.shopName ?? '',
    currency: s?.currency ?? '',
    timezone: s?.timezone ?? '',
    accentHex: s?.accentHex ?? '#244ACC',
    creatorName: s?.creatorName ?? '',
    creatorBio: s?.creatorBio ?? '',
    introduction: s?.introduction ?? '',
    featuredProductId: s?.featuredProductId ?? '',
    contactLinks: s?.contactLinks ?? [],
    legalName: s?.sellerDetails?.legalName ?? '',
    address: s?.sellerDetails?.address ?? '',
    contactEmail: s?.sellerDetails?.contactEmail ?? '',
    vatId: s?.sellerDetails?.vatId ?? '',
    terms: s?.legalPages?.terms ?? '',
    privacy: s?.legalPages?.privacy ?? '',
    refund: s?.legalPages?.refund ?? '',
    taxMode: s?.taxMode ?? 'unset',
    logoAlt: s?.logoAlt ?? '',
    acceptConsent: false,
  };
}

/** Builds a PATCH body with only the fields that changed. */
export function shopChanges(initial: Form, form: Form): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const simple: Array<keyof Form> = ['shopName', 'currency', 'timezone', 'accentHex', 'creatorName', 'creatorBio', 'introduction', 'taxMode', 'logoAlt'];
  for (const key of simple) if (form[key] !== initial[key]) out[key] = typeof form[key] === 'string' ? (form[key] as string).trim() : form[key];
  if (form.featuredProductId !== initial.featuredProductId) out.featuredProductId = form.featuredProductId || null;
  if (JSON.stringify(form.contactLinks) !== JSON.stringify(initial.contactLinks)) out.contactLinks = form.contactLinks.map((l) => ({ label: l.label.trim(), url: l.url.trim() })).filter((l) => l.label || l.url);
  const seller: Record<string, string> = {};
  for (const key of ['legalName', 'address', 'contactEmail', 'vatId'] as const) if (form[key] !== initial[key]) seller[key] = form[key].trim();
  if (Object.keys(seller).length) out.sellerDetails = seller;
  const legal: Record<string, string> = {};
  for (const key of ['terms', 'privacy', 'refund'] as const) if (form[key] !== initial[key]) legal[key] = form[key].trim();
  if (Object.keys(legal).length) out.legalPages = legal;
  if (form.acceptConsent) out.digitalDeliveryConsentAccepted = true;
  return out;
}

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN', 'JPY'];

/** C05 branding, creator, legal and launch settings. */
export function SettingsPage() {
  useDocumentTitle('Settings');
  const { state, reload, set } = useApiResource<OwnerShopResponse>('/api/owner/shop');
  const products = useApiResource<{ products: OwnerProduct[] }>('/api/owner/products?status=published');
  const settings = state.kind === 'ready' ? state.data.settings : null;
  const initial = useMemo(() => toForm(settings), [settings]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  // Reset only when the saved values change, not on every reload of the same data (publish polling, uploads, reorders).
  const initialKey = JSON.stringify(initial);
  useEffect(() => setForm(JSON.parse(initialKey) as typeof initial), [initialKey]);
  const changes = shopChanges(initial, form);
  const dirty = Object.keys(changes).length > 0;
  useUnsavedWarning(dirty);

  if (state.kind === 'loading') return <Skeleton label="Loading settings" lines={5} />;
  if (state.kind === 'failed') return <><StudioHeading title="Settings" /><ErrorNotice title="Settings did not load" error={state.error} onRetry={reload} /></>;

  const issues = issuesByPath(error);
  const accentValid = HEX_COLOR.test(form.accentHex);
  const ratio = accentValid ? contrastRatio(form.accentHex, '#ffffff') : 0;
  const launch = state.data.launchReady;
  const currencyLocked = Boolean(settings?.currency);
  const fieldIds: Record<string, string> = { shopName: 'set-shopName', currency: 'set-currency', accentHex: 'set-accent', legalPages: 'set-terms', sellerDetails: 'set-legalName', contactLinks: 'set-links', timezone: 'set-timezone' };
  const summary = Object.entries(issues).filter(([p]) => !p.includes('.')).map(([p, m]) => ({ id: fieldIds[p], message: m }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dirty) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await api<OwnerShopResponse>('/api/owner/shop', { method: 'PATCH', body: changes });
      set(result);
      setSaved(true);
    } catch (e) {
      setError(e);
      requestAnimationFrame(() => (document.querySelector('.error-summary') as HTMLElement | null)?.focus());
    } finally {
      setBusy(false);
    }
  }

  const f = (key: keyof Form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  return (
    <>
      <StudioHeading title="Settings" lead="Your shop’s name, look, creator profile and the legal details buyers see." />
      {launch.ready ? (
        <Notice tone="success" title="Ready to take payments" live="off"><p>All launch settings are complete.</p></Notice>
      ) : (
        <Notice tone="danger" title="Checkout is not ready yet" live="off">
          <p>Complete these settings before visitors can buy:</p>
          <ul className="requirements">{launch.missing.map((m) => <li key={m}>{requirementLabel(m)}</li>)}</ul>
        </Notice>
      )}
      <form className="settings" onSubmit={submit} noValidate>
        <ErrorSummary errors={summary} />

        <fieldset className="settings__group">
          <legend className="settings__legend">Shop</legend>
          <Field id="set-shopName" label="Shop name" value={form.shopName} maxLength={120} error={issues.shopName} onChange={f('shopName')} />
          <SelectField id="set-currency" label="Currency" description={currencyLocked ? 'The currency cannot change once prices exist.' : 'All prices use this currency. Choose carefully: it cannot change later.'} value={form.currency} disabled={currencyLocked} error={issues.currency} onChange={f('currency')}>
            <option value="">Choose a currency</option>
            {[...new Set([...(form.currency ? [form.currency] : []), ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
          </SelectField>
          <Field id="set-timezone" label="Time zone" description="For dates in emails and reports, for example Europe/Rome." value={form.timezone} maxLength={64} error={issues.timezone} onChange={f('timezone')} />
        </fieldset>

        <fieldset className="settings__group">
          <legend className="settings__legend">Look</legend>
          <div className="accent-field">
            <Field id="set-accent" label="Accent colour" description="Six-digit hex, used for main buttons." value={form.accentHex} maxLength={7} spellCheck={false} className="field--narrow" error={issues.accentHex ?? (!accentValid ? 'Use a colour like #244ACC.' : undefined)} onChange={f('accentHex')} />
            <input type="color" className="accent-field__picker" aria-label="Pick the accent colour" value={accentValid ? form.accentHex : '#244acc'} onChange={(e) => setForm({ ...form, accentHex: e.target.value.toUpperCase() })} />
          </div>
          {accentValid ? (
            <p className={ratio >= 4.5 ? 'contrast contrast--ok' : 'contrast contrast--fail'}>
              White text on this colour: {ratio.toFixed(1)}:1. {ratio >= 4.5 ? 'Readable (meets 4.5:1).' : 'Too low for text (needs 4.5:1). The shop keeps the default blue for buttons until you pick a darker colour.'}
            </p>
          ) : null}
          <TextAreaField label="Introduction" description="One or two sentences under the shop name on the home page." rows={3} value={form.introduction} maxLength={2000} error={issues.introduction} onChange={f('introduction')} />
          <SelectField label="Featured product" description="Shown large on the home page. Only published products can be featured." value={form.featuredProductId} error={issues.featuredProductId} onChange={f('featuredProductId')}>
            <option value="">First course in the shop</option>
            {products.state.kind === 'ready' ? products.state.data.products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>) : null}
          </SelectField>
          <Field label="Logo description" description="For people who cannot see the logo; usually the shop name." value={form.logoAlt} maxLength={300} error={issues.logoAlt} onChange={f('logoAlt')} />
        </fieldset>

        <fieldset className="settings__group">
          <legend className="settings__legend">Creator</legend>
          <Field label="Creator name" value={form.creatorName} maxLength={120} error={issues.creatorName} onChange={f('creatorName')} />
          <TextAreaField label="About the creator" rows={4} value={form.creatorBio} maxLength={2000} error={issues.creatorBio} onChange={f('creatorBio')} />
        </fieldset>

        <fieldset className="settings__group" id="set-links" tabIndex={-1}>
          <legend className="settings__legend">Contact links</legend>
          <p className="field__description">Shown on the Help page. https or mailto links, up to 10.</p>
          <ol className="list-editor__items">
            {form.contactLinks.map((link, i) => (
              <li key={i} className="list-editor__item link-editor">
                <Field label={`Link ${i + 1} label`} value={link.label} maxLength={60} error={issues[`contactLinks.${i}.label`]} onChange={(e) => setForm({ ...form, contactLinks: form.contactLinks.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)) })} />
                <Field label={`Link ${i + 1} address`} value={link.url} maxLength={300} spellCheck={false} error={issues[`contactLinks.${i}.url`]} onChange={(e) => setForm({ ...form, contactLinks: form.contactLinks.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)) })} />
                <span className="list-editor__controls">
                  <MoveButtons itemLabel={`link ${i + 1}`} index={i} count={form.contactLinks.length} onMove={(a, b) => setForm({ ...form, contactLinks: moveItem(form.contactLinks, a, b) })} />
                  <Button variant="quiet" onClick={() => setForm({ ...form, contactLinks: form.contactLinks.filter((_, j) => j !== i) })}>Remove<span className="visually-hidden">: link {i + 1}</span></Button>
                </span>
              </li>
            ))}
          </ol>
          {form.contactLinks.length < 10 ? <Button variant="secondary" onClick={() => setForm({ ...form, contactLinks: [...form.contactLinks, { label: '', url: '' }] })}>Add a link</Button> : null}
        </fieldset>

        <fieldset className="settings__group">
          <legend className="settings__legend">Seller details</legend>
          <p className="field__description">Shown on receipts and required before checkout. Not shown on the public shop pages.</p>
          <Field id="set-legalName" label="Legal name" value={form.legalName} maxLength={160} error={issues['sellerDetails.legalName']} onChange={f('legalName')} />
          <TextAreaField label="Address" rows={3} value={form.address} maxLength={500} error={issues['sellerDetails.address']} onChange={f('address')} />
          <Field label="Contact email" type="email" value={form.contactEmail} maxLength={254} error={issues['sellerDetails.contactEmail']} onChange={f('contactEmail')} />
          <Field label="VAT ID (optional)" value={form.vatId} maxLength={40} error={issues['sellerDetails.vatId']} onChange={f('vatId')} />
        </fieldset>

        <fieldset className="settings__group">
          <legend className="settings__legend">Legal pages</legend>
          <p className="field__description">Links to your published pages: a path on this site starting with /, or an https address.</p>
          <Field id="set-terms" label="Terms of sale" value={form.terms} maxLength={300} spellCheck={false} error={issues['legalPages.terms']} onChange={f('terms')} />
          <Field label="Privacy notice" value={form.privacy} maxLength={300} spellCheck={false} error={issues['legalPages.privacy']} onChange={f('privacy')} />
          <Field label="Refund policy" value={form.refund} maxLength={300} spellCheck={false} error={issues['legalPages.refund']} onChange={f('refund')} />
        </fieldset>

        <fieldset className="settings__group">
          <legend className="settings__legend">Tax and delivery</legend>
          <RadioGroup legend="Tax" name="taxMode" value={form.taxMode} onChange={(v) => setForm({ ...form, taxMode: v })} description="Pagelet is not a merchant of record. Check your obligations with an adviser." options={[
            { value: 'unset', label: 'Not decided yet', description: 'Checkout stays closed until you choose.' },
            { value: 'none', label: 'No tax is added', description: 'Prices are final.' },
            { value: 'stripe_tax_configured', label: 'Stripe Tax calculates tax', description: 'Only if you have set up Stripe Tax and your registrations in Stripe.' },
          ]} />
          {settings && settings.digitalDeliveryConsentVersion >= 1 ? (
            <p className="field__description">Digital delivery consent: accepted (version {settings.digitalDeliveryConsentVersion}).</p>
          ) : (
            <CheckboxField label="Ask buyers to agree to immediate digital delivery" description="Buyers confirm at checkout that access starts immediately, which can affect their withdrawal right. Required before checkout opens." checked={form.acceptConsent} onChange={(v) => setForm({ ...form, acceptConsent: v })} />
          )}
        </fieldset>

        <div className="form-actions form-actions--sticky">
          <Button type="submit" disabled={!dirty} busy={busy} busyLabel="Saving…">Save settings</Button>
          {dirty ? <span className="form-actions__note">Unsaved changes</span> : null}
          <p className="save-status" role="status">{saved && !dirty ? 'Saved' : ''}</p>
        </div>
        {error && summary.length === 0 && !Object.keys(issues).length ? <ErrorNotice title="Settings were not saved" error={error} /> : null}
      </form>

      <section className="settings__group settings__logo" aria-labelledby="logo-title">
        <h2 id="logo-title" className="settings__legend">Logo</h2>
        <p className="field__description">{settings?.logoAssetId ? 'A logo is set. Upload a new one to replace it.' : 'No logo yet. The shop shows its name instead.'}</p>
        <Uploader kind="logo" label="Choose a logo" description="PNG or JPEG, up to 2 MB." onUploaded={async (asset) => {
          try {
            set(await api<OwnerShopResponse>('/api/owner/shop', { method: 'PATCH', body: { logoAssetId: asset.id } }));
          } catch (e) {
            setError(e);
          }
        }} />
      </section>
    </>
  );
}
