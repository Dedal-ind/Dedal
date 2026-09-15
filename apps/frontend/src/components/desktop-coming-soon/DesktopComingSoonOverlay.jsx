// DesktopComingSoonOverlay.jsx
// The full-screen overlay shown on viewports 768px and wider — Dedal is a
// mobile product, so the whole app is replaced by this, on dedal tokens: the oversized tracked wordmark, a
// CSS-only phone mockup beside the pitch, aspirational store buttons (visual
// only — no native apps exist), and a real QR to the mobile site. Stacks to a
// single column below md so it still reads if it ever renders narrow.

import { ArrowLeft, Download, ShoppingBag } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Link } from 'react-router-dom';
import { BRAND_IDENTITY } from '../../brand/brand-identity.js';
import { DESKTOP_COMING_SOON_COPY } from '../../brand/brand-copy.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';

// A CSS-only phone frame: dark rounded shell, notch, and the brand card inside.
function PhoneMockup() {
  return (
    <div
      className="relative h-[560px] w-[280px] shrink-0 overflow-hidden rounded-[40px] border-[10px] border-[var(--ink)] bg-[var(--surface)] shadow-[var(--e1)]"
      aria-hidden="true"
    >
      {/* Notch */}
      <span className="absolute left-1/2 top-2 h-5 w-24 -translate-x-1/2 rounded-pill bg-[var(--ink)]" />
      {/* Miniature brand screen */}
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="font-[family-name:var(--font)] text-[32px] font-bold leading-none text-[var(--ink)]">
          {BRAND_IDENTITY.appName.toLowerCase()}
        </span>
        <span className="h-px w-16 bg-[var(--primary)]" />
        <span className="font-[family-name:var(--font)] text-[12px] leading-[18px] text-[var(--muted)]">
          {BRAND_IDENTITY.tagline}
        </span>
      </div>
    </div>
  );
}

// Aspirational store button — deliberately not a link; there is nothing to open.
function StoreBadge({ icon: Icon, label }) {
  return (
    <span className="flex items-center gap-2 rounded-xl bg-[var(--ink)] px-5 py-3 font-[family-name:var(--font)] text-[14px] font-semibold leading-5 text-white">
      <Icon size={20} aria-hidden="true" />
      {label}
    </span>
  );
}

function DesktopComingSoonOverlay() {
  const { isAuthenticated } = useAuthentication();

  return (
    <div className="flex min-h-screen w-full flex-col items-center bg-[var(--surface)] px-6">
      {/* Back-to-login — same level as dedal title, left side. */}
      {isAuthenticated && (
        <div className="fixed left-8 top-12 z-50">
          <Link
            to="/sign-out"
            aria-label="Back to login"
            className="flex items-center gap-3 rounded-[var(--r-card)] border border-[var(--divider)] bg-[var(--surface-card)] px-5 py-3 shadow-[var(--e1)] transition-transform hover:scale-105 active:scale-95"
          >
            <ArrowLeft size={24} className="text-[var(--ink)]" aria-hidden="true" />
            <span className="font-[family-name:var(--font)] text-[15px] font-semibold text-[var(--ink)]">Back to login</span>
          </Link>
        </div>
      )}

      {/* Wordmark */}
      <h1 className="mt-16 font-[family-name:var(--font)] text-[64px] font-bold lowercase leading-none tracking-[0.15em] text-[var(--ink)]">
        {BRAND_IDENTITY.appName}
      </h1>

      {/* Two columns on md+, stacked below */}
      <div className="my-auto flex w-full max-w-[900px] flex-col items-center gap-10 py-12 md:flex-row md:gap-14">
        <div className="flex justify-center md:w-[45%]">
          <PhoneMockup />
        </div>
        <div className="flex flex-col items-center text-center md:w-[55%] md:items-start md:text-left">
          <h2 className="font-[family-name:var(--font)] text-[32px] font-bold leading-10 text-[var(--ink)]">
            {DESKTOP_COMING_SOON_COPY.headline}
          </h2>
          <p className="mt-3 max-w-[420px] font-[family-name:var(--font)] text-[16px] leading-[26px] text-[var(--muted)]">
            {DESKTOP_COMING_SOON_COPY.subhead}
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-3 md:justify-start">
            <StoreBadge icon={Download} label={DESKTOP_COMING_SOON_COPY.appStoreButton} />
            <StoreBadge icon={ShoppingBag} label={DESKTOP_COMING_SOON_COPY.playStoreButton} />
          </div>

          {/* QR — real, encoding the live site. */}
          <div className="mt-6 flex items-center gap-4 rounded-xl border border-[var(--divider)] bg-[var(--surface-card)] p-4 shadow-[var(--e1)]">
            <div className="shrink-0 rounded-[var(--r-card)] border border-[var(--divider)] bg-[var(--surface-card)] p-1.5">
              <QRCodeSVG value={BRAND_IDENTITY.siteUrl} size={80} level="M" />
            </div>
            <p className="max-w-[180px] font-[family-name:var(--font)] text-[14px] leading-[22px] text-[var(--ink)]">
              {DESKTOP_COMING_SOON_COPY.qrTitle}
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="w-full max-w-[900px] pb-8">
        <div className="h-px w-full bg-[var(--divider)]" aria-hidden="true" />
        <p className="mt-4 text-center font-[family-name:var(--font)] text-[12px] font-bold uppercase leading-4 tracking-[0.15em] text-[var(--muted)]">
          {DESKTOP_COMING_SOON_COPY.taglineCaps}
        </p>
      </footer>
    </div>
  );
}

export default DesktopComingSoonOverlay;
