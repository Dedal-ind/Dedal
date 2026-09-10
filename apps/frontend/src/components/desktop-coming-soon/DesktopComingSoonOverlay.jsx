// DesktopComingSoonOverlay.jsx
// The full-screen overlay shown on viewports 768px and wider — Dedal is a
// mobile product, so the whole app is replaced by this. Heritage Institutional
// (the "Desktop Coming Soon" Stitch frame): the oversized tracked wordmark, a
// CSS-only phone mockup beside the pitch, aspirational store buttons (visual
// only — no native apps exist), and a real QR to the mobile site. Stacks to a
// single column below md so it still reads if it ever renders narrow.

import { QRCodeSVG } from 'qrcode.react';
import { Link } from 'react-router-dom';
import { BRAND_IDENTITY } from '../../brand/brand-identity.js';
import { DESKTOP_COMING_SOON_COPY } from '../../brand/brand-copy.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';

// A CSS-only phone frame: dark rounded shell, notch, and the brand card inside.
function PhoneMockup() {
  return (
    <div
      className="relative h-[560px] w-[280px] shrink-0 overflow-hidden rounded-[40px] border-[10px] border-primary-container bg-background shadow-subtle"
      aria-hidden="true"
    >
      {/* Notch */}
      <span className="absolute left-1/2 top-2 h-5 w-24 -translate-x-1/2 rounded-pill bg-primary-container" />
      {/* Miniature brand screen */}
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="font-display text-[32px] font-bold leading-none text-primary">
          {BRAND_IDENTITY.appName.toLowerCase()}
        </span>
        <span className="h-px w-16 bg-olive-accent" />
        <span className="font-body text-[12px] leading-[18px] text-on-surface-variant">
          {BRAND_IDENTITY.tagline}
        </span>
      </div>
    </div>
  );
}

// Aspirational store button — deliberately not a link; there is nothing to open.
function StoreBadge({ iconName, label }) {
  return (
    <span className="flex items-center gap-2 rounded-xl bg-primary-container px-5 py-3 font-body text-[14px] font-semibold leading-5 text-on-primary">
      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
        {iconName}
      </span>
      {label}
    </span>
  );
}

function DesktopComingSoonOverlay() {
  const { isAuthenticated } = useAuthentication();

  return (
    <div className="flex min-h-screen w-full flex-col items-center bg-background px-6">
      {/* Back-to-login — same level as dedal title, left side. */}
      {isAuthenticated && (
        <div className="fixed left-8 top-12 z-50">
          <Link
            to="/sign-out"
            aria-label="Back to login"
            className="flex items-center gap-3 rounded-heritage border border-outline-variant bg-surface-container-lowest px-5 py-3 shadow-subtle transition-transform hover:scale-105 active:scale-95"
          >
            <span className="material-symbols-outlined text-[24px] text-primary" aria-hidden="true">
              arrow_back
            </span>
            <span className="font-body text-[15px] font-semibold text-on-surface">Back to login</span>
          </Link>
        </div>
      )}

      {/* Wordmark */}
      <h1 className="mt-16 font-display text-[64px] font-bold lowercase leading-none tracking-[0.15em] text-primary">
        {BRAND_IDENTITY.appName}
      </h1>

      {/* Two columns on md+, stacked below */}
      <div className="my-auto flex w-full max-w-[900px] flex-col items-center gap-10 py-12 md:flex-row md:gap-14">
        <div className="flex justify-center md:w-[45%]">
          <PhoneMockup />
        </div>
        <div className="flex flex-col items-center text-center md:w-[55%] md:items-start md:text-left">
          <h2 className="font-display text-[32px] font-bold leading-10 text-on-surface">
            {DESKTOP_COMING_SOON_COPY.headline}
          </h2>
          <p className="mt-3 max-w-[420px] font-body text-[16px] leading-[26px] text-on-surface-variant">
            {DESKTOP_COMING_SOON_COPY.subhead}
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-3 md:justify-start">
            <StoreBadge iconName="download" label={DESKTOP_COMING_SOON_COPY.appStoreButton} />
            <StoreBadge iconName="shop_2" label={DESKTOP_COMING_SOON_COPY.playStoreButton} />
          </div>

          {/* QR — real, encoding the live site. */}
          <div className="mt-6 flex items-center gap-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-subtle">
            <div className="shrink-0 rounded-large border border-outline-variant bg-surface-container-lowest p-1.5">
              <QRCodeSVG value={BRAND_IDENTITY.siteUrl} size={80} level="M" />
            </div>
            <p className="max-w-[180px] font-body text-[14px] leading-[22px] text-on-surface">
              {DESKTOP_COMING_SOON_COPY.qrTitle}
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="w-full max-w-[900px] pb-8">
        <div className="h-px w-full bg-outline-variant" aria-hidden="true" />
        <p className="mt-4 text-center font-body text-[12px] font-bold uppercase leading-4 tracking-[0.15em] text-on-surface-variant">
          {DESKTOP_COMING_SOON_COPY.taglineCaps}
        </p>
      </footer>
    </div>
  );
}

export default DesktopComingSoonOverlay;
