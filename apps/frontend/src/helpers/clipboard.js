// clipboard.js
// Copy text to the clipboard and say whether it worked.
//
// navigator.clipboard is unavailable on an insecure origin and can be refused
// on a secure one, so the caller is told the outcome — a code somebody believes
// they copied and did not is worse than a visible failure.

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
