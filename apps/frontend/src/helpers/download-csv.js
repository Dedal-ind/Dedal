// download-csv.js
// Fetch an authenticated CSV and save it under a sensible filename.
//
// ONE PATH FOR EVERY STAFF DOWNLOAD. The coordinator screen went through
// apiClient; the volunteer screen had its own fetch that re-read the token from
// storage and re-derived the API base URL by hand. Two copies of "how to call
// the API" is how one of them misses the next change to either — so both now go
// through apiClient, which already owns the token, the base URL and the 401
// handling.
//
// Throws on failure, so the caller can put the message in the page rather than
// in a blocking alert.
//
// The blob goes through a hidden anchor rather than window.open so the file
// downloads with its name instead of opening as a tab of raw text.

import apiClient from '../api-client/api-client.js';

export async function downloadCsv(path, filename) {
  const payload = await apiClient.get(path, { responseType: 'blob' });
  const blob = payload instanceof Blob ? payload : new Blob([payload], { type: 'text/csv' });
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}
