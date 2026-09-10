// TermsOfServiceScreen.jsx
// Route: /terms-of-service — the Terms of Service currently in effect,
// fetched from the policy registry. No text lives here: the backend is the
// single source of what a participant reads and consents to.

import PolicyDocumentScreen from '../../components/policy-document/PolicyDocumentScreen.jsx';
import { POLICY_KINDS } from '../../helpers/policy-documents.js';
import { POLICY_DOCUMENT_COPY } from '../../brand/brand-copy.js';

function TermsOfServiceScreen() {
  return (
    <PolicyDocumentScreen
      title={POLICY_DOCUMENT_COPY.termsTitle}
      kind={POLICY_KINDS.TERMS_OF_SERVICE}
    />
  );
}

export default TermsOfServiceScreen;
