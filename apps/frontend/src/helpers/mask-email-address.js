// mask-email-address.js
// Shows a participant WHICH inbox their pass was sent to without printing the
// whole address on a screen they may hold up at a crowded gate. Keeps the first
// and last character of the local part and the entire domain, so the owner
// recognises it instantly and a bystander learns nothing useful.
export function maskEmailAddress(emailAddress) {
  if (typeof emailAddress !== 'string' || !emailAddress.includes('@')) {
    return '';
  }
  const [localPart, domain] = emailAddress.split('@');
  if (localPart.length <= 2) {
    return `${localPart[0] ?? ''}•@${domain}`;
  }
  const maskedMiddle = '•'.repeat(Math.min(6, localPart.length - 2));
  return `${localPart[0]}${maskedMiddle}${localPart[localPart.length - 1]}@${domain}`;
}
