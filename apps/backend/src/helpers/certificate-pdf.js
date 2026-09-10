const PdfDocument = require("pdfkit");

/*
 * Fetches a template image (JPEG/PNG, enforced at upload) into a Buffer.
 * Rendering previously touched no network, so this is a new failure mode on the
 * certificate path — any failure resolves to null and the certificate renders
 * WITHOUT the image rather than throwing: a plain certificate beats a failed
 * download for a participant who is waiting on one.
 */
async function loadTemplateImageBuffer(imageUrl) {
  if (!imageUrl) {
    return null;
  }
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    console.error(`Certificate template image failed to load (${imageUrl}): ${error.message}`);
    return null;
  }
}

/* Draws an image, swallowing a corrupt-image failure the same way a fetch failure is. */
function drawImageSafely(document, imageBuffer, x, y, options) {
  try {
    document.image(imageBuffer, x, y, options);
    return true;
  } catch (error) {
    console.error(`Certificate template image could not be drawn: ${error.message}`);
    return false;
  }
}

/*
 * Renders one certificate to a PDF Buffer. pdfkit writes to a stream, so the
 * chunks are gathered and the promise resolves on 'end'. The template image is
 * drawn FIRST — pdfkit's drawing order is z-order, so a background drawn later
 * would erase the text — sized to cover the full A4-landscape page.
 *
 * The uploaded template IS the certificate: titles, seals, signatures and any
 * QR the organiser wants live inside the artwork. This renderer therefore
 * overlays ONE thing only — the participant's name, centred in the name slot
 * (~42% down the page). No title, no college line, no achievement line, no QR,
 * no verification code on the PDF. The verificationCode stays on the DATABASE
 * record and remains checkable on /verify-certificate; it just is not printed.
 *
 * With no template (rare — admins upload artwork), a minimal fallback renders
 * a plain "Certificate" title over the name so the file is never blank.
 */
async function renderCertificatePdf({ metadata, template = null }) {
  // Fetched before the stream starts, so the synchronous drawing below stays intact.
  const backgroundImageBuffer = await loadTemplateImageBuffer(template?.documentTemplateUrl);

  return new Promise((resolve, reject) => {
    const document = new PdfDocument({ size: "A4", layout: "landscape", margin: 60 });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    if (backgroundImageBuffer) {
      const backgroundDrawn = drawImageSafely(document, backgroundImageBuffer, 0, 0, {
        width: document.page.width,
        height: document.page.height,
      });
      if (backgroundDrawn) {
        document.font("Times-Bold").fontSize(34).text(metadata.fullName || "—", 0, document.page.height * 0.42, {
          align: "center",
          width: document.page.width,
        });
        document.end();
        return;
      }
      // A corrupt template falls through to the minimal fallback below.
      document.x = document.page.margins.left;
      document.y = document.page.margins.top;
    }

    // Minimal fallback — no template artwork available.
    document.font("Helvetica-Bold").fontSize(28).text("Certificate", 0, document.page.height * 0.32, {
      align: "center",
      width: document.page.width,
    });
    document.font("Times-Bold").fontSize(34).text(metadata.fullName || "—", 0, document.page.height * 0.42, {
      align: "center",
      width: document.page.width,
    });

    document.end();
  });
}

module.exports = { renderCertificatePdf };
