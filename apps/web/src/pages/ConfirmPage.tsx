import { useNavigate } from 'react-router-dom';
import { TokenActionPage } from '../components/TokenActionPage';
import { api } from '../lib/api';
import { safeReturnTo } from '../lib/returnTo';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function ConfirmPage() {
  useDocumentTitle('Confirm sign-in');
  const navigate = useNavigate();
  return (
    <TokenActionPage
      title="Confirm sign-in"
      intro="Press the button to finish signing in on this device. Only continue if you asked for this link."
      actionLabel="Confirm sign-in"
      busyLabel="Signing in…"
      failureTitle="Sign-in did not finish"
      newLinkTo="/account/sign-in"
      newLinkLabel="Request a new link"
      onConfirm={async (token) => {
        const result = await api<{ returnTo?: unknown }>('/api/auth/sessions', { method: 'POST', body: { token } });
        navigate(safeReturnTo(result?.returnTo), { replace: true });
      }}
    />
  );
}
