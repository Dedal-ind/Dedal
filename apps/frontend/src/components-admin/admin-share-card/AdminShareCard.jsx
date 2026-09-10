// AdminShareCard.jsx
// "Share Your Fest" card for the admin console: the public URL in a monospace
// row with a copy action, a QR code, and a 1024px PNG download of that QR for
// posters. Unpublished targets get only an explanatory note — a draft has no
// public URL to share, and rendering a dead link would be worse than silence.
//
// The PNG download re-renders the on-screen SVG: serialize it, load it into an
// Image via a data: URL, draw it onto an off-screen 1024x1024 canvas, and hand
// the blob to a programmatic <a download> click. No external toast/download lib.

import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Download, Share2 } from 'lucide-react';
import AdminExecutiveCard from '../admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../admin-executive-button/AdminExecutiveButton.jsx';

// Local copy only — brand-copy.js is out of bounds for this component.
const COPY = {
  copyUrl: 'Copy URL',
  copied: 'Copied',
  downloadQr: 'Download QR Code',
  urlLabel: 'Public URL',
};

const QR_DISPLAY_SIZE = 200;
const QR_EXPORT_SIZE = 1024;
const COPIED_RESET_MS = 2000;

function AdminShareCard({ title, url, downloadFileName, note, isPublished, unpublishedNote }) {
  const svgContainerRef = useRef(null);
  const copiedTimeoutRef = useRef(null);
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => () => clearTimeout(copiedTimeoutRef.current), []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setIsCopied(true);
      clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => setIsCopied(false), COPIED_RESET_MS);
    } catch {
      // Clipboard refused (permissions/insecure context) — the URL is visible
      // and selectable in the row, so a manual copy is still possible.
    }
  }

  function handleDownload() {
    const svgElement = svgContainerRef.current?.querySelector('svg');
    if (!svgElement) {
      return;
    }
    const svgString = new XMLSerializer().serializeToString(svgElement);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = QR_EXPORT_SIZE;
      canvas.height = QR_EXPORT_SIZE;
      const context = canvas.getContext('2d');
      // White ground behind the QR — a transparent PNG on a dark poster scans badly.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, QR_EXPORT_SIZE, QR_EXPORT_SIZE);
      context.drawImage(image, 0, 0, QR_EXPORT_SIZE, QR_EXPORT_SIZE);
      canvas.toBlob((blob) => {
        if (!blob) {
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = downloadFileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      }, 'image/png');
    };
    image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;
  }

  return (
    <AdminExecutiveCard title={title}>
      {!isPublished ? (
        <p className="font-admin-body text-[14px] leading-5 text-admin-slate-600">
          {unpublishedNote}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {/* URL row + copy */}
          <div className="flex flex-col gap-2">
            <span className="font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
              {COPY.urlLabel}
            </span>
            <div className="flex flex-wrap items-stretch gap-2">
              <div className="flex min-w-0 flex-1 items-center overflow-x-auto rounded-md border border-admin-slate-200 bg-admin-surface-off-white px-3 py-2">
                <span className="whitespace-nowrap font-admin-mono text-[13px] text-admin-neutral-ink">
                  {url}
                </span>
              </div>
              <AdminExecutiveButton
                variant="secondary"
                iconLeft={isCopied ? <Check size={15} /> : <Copy size={15} />}
                onClick={handleCopy}
              >
                {isCopied ? COPY.copied : COPY.copyUrl}
              </AdminExecutiveButton>
            </div>
          </div>

          {/* QR code + download */}
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div
              ref={svgContainerRef}
              className="shrink-0 rounded-md border border-admin-slate-200 bg-white p-3"
            >
              <QRCodeSVG value={url} size={QR_DISPLAY_SIZE} level="H" />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <AdminExecutiveButton
                variant="secondary"
                iconLeft={<Download size={15} />}
                onClick={handleDownload}
                className="self-start"
              >
                {COPY.downloadQr}
              </AdminExecutiveButton>
              {note ? (
                <p className="flex items-start gap-2 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
                  <Share2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{note}</span>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </AdminExecutiveCard>
  );
}

export default AdminShareCard;
