// PolicyVersionScreen.jsx
// Route: /policies/versions/:versionId — one specific version of a legal
// document, shown back exactly as it was published, so an acceptance
// recorded earlier can be read again in the wording that was accepted. The
// document says which kind it is and whether it is still in effect.

import { useParams } from 'react-router-dom';
import PolicyDocumentScreen from '../../components/policy-document/PolicyDocumentScreen.jsx';
import { POLICY_DOCUMENT_COPY } from '../../brand/brand-copy.js';

function PolicyVersionScreen() {
  const { versionId } = useParams();
  return <PolicyDocumentScreen title={POLICY_DOCUMENT_COPY.versionTitle} versionId={versionId} />;
}

export default PolicyVersionScreen;
