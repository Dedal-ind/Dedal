/*
 * The frame every Dedal email is rendered inside.
 *
 * WHY TABLES AND INLINE STYLES. An email is not a web page. Gmail strips
 * <style> blocks in some contexts and all of them in the mobile clients;
 * Outlook renders through Word's HTML engine, which has no flexbox and no CSS
 * grid at all. Nested <table> with inline style attributes is the only layout
 * that survives every client, which is why this file looks like 2004.
 *
 * NO CUSTOM FONTS. Space Grotesk and Satoshi carry the brand in the app, but a
 * @font-face in an email either fails to load or is blocked outright, and the
 * fallback is then whatever the client picks. Arial/Helvetica is chosen ON
 * PURPOSE so the result is identical everywhere rather than accidental.
 *
 * NO REMOTE IMAGE FOR THE DEDAL MARK. Most clients block remote images until
 * the reader clicks "show images", so a logo <img> is an empty box on first
 * open — the exact "looks like a developer test" problem this is meant to fix.
 * The Dedal mark is therefore TEXT styled to look like the wordmark, which
 * cannot fail to render. A fest banner is a real <img> because there is no text
 * substitute for it, and it carries alt text for the blocked case.
 */

const { applicationConfig } = require("../config/application-config");

/* The brutalist palette, the only four colours an email may use. */
const BRAND_COLOURS = {
  text: "#1A1A1A",
  surface: "#FFFFFF",
  accent: "#E8481D",
  wrapper: "#F5F0EB",
  mutedText: "#6B6B6B",
  hairline: "#E5E0DA",
};

const EMAIL_FONT_STACK = "Arial, Helvetica, sans-serif";
const EMAIL_CONTENT_WIDTH_PIXELS = 600;
const BRAND_LOGO_HEIGHT_PIXELS = 40;

const FOOTER_TAGLINE = "Sent by Dedal — your pass to every fest";
const VIEW_IN_APP_LABEL = "View in app";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/*
 * The header block. A fest banner when one is known, otherwise the wordmark.
 * Left-aligned in both cases, and capped at 40px tall so a 2000px-wide fest
 * poster does not become the whole email.
 */
function buildHeaderCell({ festName, logoUrl }) {
  if (logoUrl) {
    return (
      `<img src="${escapeHtml(logoUrl)}" ` +
      `alt="${escapeHtml(festName || "Fest")}" ` +
      `height="${BRAND_LOGO_HEIGHT_PIXELS}" ` +
      `style="display:block;height:${BRAND_LOGO_HEIGHT_PIXELS}px;max-height:${BRAND_LOGO_HEIGHT_PIXELS}px;width:auto;border:0;outline:none;text-decoration:none;" />`
    );
  }
  return (
    `<span style="font-family:${EMAIL_FONT_STACK};font-size:26px;font-weight:bold;` +
    `letter-spacing:-0.5px;text-transform:uppercase;color:${BRAND_COLOURS.text};` +
    `line-height:${BRAND_LOGO_HEIGHT_PIXELS}px;">` +
    `DEDAL<span style="color:${BRAND_COLOURS.accent};">.</span>` +
    `</span>`
  );
}

/*
 * bodyHtml is a FRAGMENT — the caller's own markup, unchanged. This only ever
 * adds a frame around it, so an existing email's content is never rewritten by
 * a change to the shell.
 */
/*
 * An optional action button under the message body.
 *
 * A bordered table cell rather than a styled <a>: Outlook ignores padding and
 * background on an anchor, and the button collapses to bare underlined text.
 * Returns "" when no action is given, so the row disappears entirely rather
 * than leaving an empty band of padding.
 */
function buildActionCell({ actionUrl, actionLabel }) {
  if (!actionUrl || !actionLabel) {
    return "";
  }
  return `
            <tr>
              <td align="left" style="padding:0 24px 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="background-color:${BRAND_COLOURS.text};border:2px solid ${BRAND_COLOURS.text};">
                      <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 24px;font-family:${EMAIL_FONT_STACK};font-size:14px;font-weight:700;line-height:18px;color:${BRAND_COLOURS.surface};text-decoration:none;">${escapeHtml(actionLabel)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

function wrapInBrandedTemplate(bodyHtml, { festName, logoUrl, actionUrl, actionLabel } = {}) {
  const appUrl = applicationConfig.frontendBaseUrl;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(festName || "Dedal")}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${BRAND_COLOURS.wrapper};">
    <!-- Outer wrapper: full-bleed warm white behind the content card. -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND_COLOURS.wrapper};margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="${EMAIL_CONTENT_WIDTH_PIXELS}" cellpadding="0" cellspacing="0" border="0" style="width:${EMAIL_CONTENT_WIDTH_PIXELS}px;max-width:100%;background-color:${BRAND_COLOURS.surface};border:2px solid ${BRAND_COLOURS.text};">

            <tr>
              <td align="left" style="padding:20px 24px;border-bottom:2px solid ${BRAND_COLOURS.text};">
                ${buildHeaderCell({ festName, logoUrl })}
              </td>
            </tr>

            <tr>
              <td style="padding:24px;font-family:${EMAIL_FONT_STACK};font-size:14px;line-height:21px;color:${BRAND_COLOURS.text};">
                ${bodyHtml}
              </td>
            </tr>
${buildActionCell({ actionUrl, actionLabel })}

            <tr>
              <td style="padding:16px 24px;border-top:1px solid ${BRAND_COLOURS.hairline};font-family:${EMAIL_FONT_STACK};font-size:12px;line-height:18px;color:${BRAND_COLOURS.mutedText};">
                ${escapeHtml(FOOTER_TAGLINE)}${
                  appUrl
                    ? ` · <a href="${escapeHtml(appUrl)}" style="color:${BRAND_COLOURS.accent};text-decoration:underline;">${escapeHtml(VIEW_IN_APP_LABEL)}</a>`
                    : ""
                }
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/*
 * Turns an existing PLAIN-TEXT body into the fragment the template expects,
 * so a text-only sender gains the brand frame without its wording being
 * touched. Blank lines become paragraph breaks, single newlines become <br>,
 * and bare URLs become links — the one thing plain text loses when it is
 * dropped into HTML unprocessed.
 */
const BARE_URL_PATTERN = /(https?:\/\/[^\s<]+)/g;

function renderPlainTextAsHtml(plainText) {
  const paragraphs = String(plainText ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return paragraphs
    .map((paragraph) => {
      const escaped = escapeHtml(paragraph)
        // Escaping turned "&" into "&amp;" inside URLs too; linkify after, then
        // repair the query separators in the href only.
        .replace(/\n/g, "<br />");
      const linked = escaped.replace(BARE_URL_PATTERN, (matchedUrl) => {
        const href = matchedUrl.replace(/&amp;/g, "&");
        return `<a href="${href}" style="color:${BRAND_COLOURS.accent};text-decoration:underline;">${matchedUrl}</a>`;
      });
      return `<p style="margin:0 0 14px;font-family:${EMAIL_FONT_STACK};font-size:14px;line-height:21px;color:${BRAND_COLOURS.text};">${linked}</p>`;
    })
    .join("");
}

/*
 * The reverse trip, for a caller that has only HTML and needs the text/plain
 * alternative. Links are rendered as "label (href)" so the destination survives
 * — a text part with the URLs stripped out is worse than no text part at all.
 */
function stripHtmlToText(bodyHtml) {
  return String(bodyHtml ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h1|h2|h3)>/gi, "\n")
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (fullMatch, href, label) => {
      const cleanLabel = label.replace(/<[^>]+>/g, "").trim();
      return cleanLabel && !cleanLabel.includes(href) ? `${cleanLabel} (${href})` : href;
    })
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/*
 * The one-liner every text-only sender uses: keep the text exactly as written,
 * and derive the branded HTML from it.
 */
function buildBrandedEmailBodies(plainText, branding = {}) {
  return {
    /*
     * The plain-text part keeps the action as a bare URL. A text-only client
     * would otherwise show the message with no way to reach the thing it is
     * about — the button exists only in the HTML part.
     */
    text: branding.actionUrl ? `${plainText}\n\n${branding.actionUrl}` : plainText,
    html: wrapInBrandedTemplate(renderPlainTextAsHtml(plainText), branding),
  };
}

module.exports = {
  wrapInBrandedTemplate,
  renderPlainTextAsHtml,
  stripHtmlToText,
  buildBrandedEmailBodies,
  escapeHtml,
  BRAND_COLOURS,
  EMAIL_FONT_STACK,
  EMAIL_CONTENT_WIDTH_PIXELS,
};
