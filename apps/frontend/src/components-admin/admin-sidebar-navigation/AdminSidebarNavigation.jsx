// AdminSidebarNavigation.jsx
// The 260px fixed rail. Its field is neutral ink — the one large dark surface in
// the console — so the working area beside it reads as the lit part of the
// screen. The active item is marked by a blue vertical bar at the left edge plus
// a subtle tint, not by a filled pill: at this density a filled row every time
// you navigate is visual noise.
//
// Items come from brand-admin/brand-navigation.js as data; icons are named there
// by string and resolved through this map, so that module needs no imports.

import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Inbox,
  LayoutDashboard,
  Network,
  Flag,
  CalendarPlus,
  UserCog,
  ShieldCheck,
  Users,
  Award,
  Send,
  Database,
  Settings,
  Landmark,
  Trophy,
  BadgeCheck,
  Clock,
  CalendarRange,
  Medal,
  Megaphone,
  Tag,
  Building2,
  BarChart3,
  TrendingUp,
  Circle,
  Bell,
  LogOut,
  Search,
} from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import { ADMIN_SIDEBAR_SECTIONS } from '../../brand-admin/brand-navigation.js';
import { ADMIN_BRAND_IDENTITY } from '../../brand-admin/brand-identity.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import AdminNotificationPanel from '../admin-notification-panel/AdminNotificationPanel.jsx';
import { ADMIN_DASHBOARD_COPY, ADMIN_AUTH_COPY } from '../../brand-admin/brand-copy.js';

const ICONS = {
  Inbox,
  LayoutDashboard,
  Network,
  Flag,
  CalendarPlus,
  UserCog,
  ShieldCheck,
  Users,
  Award,
  Send,
  Database,
  Settings,
  Landmark,
  Trophy,
  BadgeCheck,
  Clock,
  CalendarRange,
  Medal,
  Megaphone,
  Tag,
  Building2,
  BarChart3,
  TrendingUp,
};

function NavigationItem({ item, badgeCount = 0 }) {
  // An unknown icon name renders a neutral dot rather than crashing the rail.
  const IconComponent = ICONS[item.iconName] ?? Circle;

  return (
    <NavLink
      to={item.route}
      className={({ isActive }) =>
        [
          'relative flex items-center gap-3 rounded-md py-2 pl-4 pr-3 transition-colors',
          'font-admin-body text-[14px] leading-5',
          isActive
            ? 'bg-admin-surface-white/10 font-medium text-admin-surface-white'
            : 'text-admin-slate-200/70 hover:bg-admin-surface-white/5 hover:text-admin-surface-white',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span
              aria-hidden="true"
              className="absolute left-0 top-1/2 h-5 w-0.75 -translate-y-1/2 rounded-full bg-admin-primary-blue"
            />
          ) : null}
          <IconComponent size={18} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate">{item.label}</span>
          {badgeCount > 0 ? (
            <span className="ml-auto shrink-0 rounded-full bg-admin-primary-blue px-2 py-0.5 font-admin-mono text-[11px] font-semibold leading-4 text-admin-surface-white">
              {badgeCount}
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}


function initialsOf(fullName) {
  return (
    (fullName || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || '?'
  );
}

function SidebarAvatar({ user }) {
  const [hasImageFailed, setHasImageFailed] = useState(false);
  const photoUrl = user?.profilePictureUrl;

  if (photoUrl && !hasImageFailed) {
    return (
      <img
        src={photoUrl}
        alt=""
        width={32}
        height={32}
        onError={() => setHasImageFailed(true)}
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-admin-primary-blue/20 font-admin-body text-[12px] font-semibold text-admin-surface-white">
      {initialsOf(user?.fullName)}
    </span>
  );
}

/*
 * The account footer. It carries what the removed topbar used to: who is signed
 * in, the notification bell, and the way out.
 *
 * The name is a LINK to the profile rather than plain text — /admin/profile is
 * not a sidebar destination, so without this the page would have no route into
 * it at all once the topbar's account menu went away.
 */
function AdminSidebarAccount() {
  const navigate = useNavigate();
  const { currentUser, signOut, administeredFests } = useAuthentication();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const bellReference = useRef(null);

  /* Fest-scoped, exactly as the topbar had it: the audit-log endpoint asserts
     the caller administers the fest it queries. */
  const firstAdministeredFest = administeredFests?.[0] ?? null;
  const notificationFestId = firstAdministeredFest?.id ?? firstAdministeredFest ?? null;

  function closeNotifications() {
    setIsNotificationsOpen(false);
    bellReference.current?.focus();
  }

  return (
    <div className="mt-auto shrink-0 border-t border-admin-surface-white/10 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/admin/profile')}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-admin-surface-white/5"
        >
          <SidebarAvatar user={currentUser} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-admin-body text-[13px] font-medium text-admin-surface-white">
              {currentUser?.fullName ?? currentUser?.emailAddress ?? '—'}
            </span>
            <span className="block truncate font-admin-mono text-[11px] text-admin-slate-600">
              {currentUser?.emailAddress ?? ''}
            </span>
          </span>
        </button>

        <div className="relative">
          <button
            ref={bellReference}
            type="button"
            aria-label={ADMIN_DASHBOARD_COPY.notifications}
            aria-haspopup="dialog"
            aria-expanded={isNotificationsOpen}
            onClick={() => setIsNotificationsOpen((previous) => !previous)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-admin-slate-600 transition-colors hover:bg-admin-surface-white/5 hover:text-admin-surface-white"
          >
            <Bell size={16} strokeWidth={1.75} />
          </button>
          {isNotificationsOpen ? (
            <>
              <button
                type="button"
                aria-hidden="true"
                tabIndex={-1}
                onMouseDown={closeNotifications}
                className="fixed inset-0 z-30 cursor-default"
              />
              {/* Opens UPWARD and to the right: anchored at the bottom of a dark
                  rail, the topbar's downward placement would fall off-screen. */}
              <div className="absolute bottom-0 left-full z-40 ml-2">
                <AdminNotificationPanel festId={notificationFestId} onClose={closeNotifications} />
              </div>
            </>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          signOut();
          navigate('/auth/email', { replace: true });
        }}
        className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 font-admin-body text-[13px] text-admin-status-error-red transition-colors hover:bg-admin-status-error-red/10"
      >
        <LogOut size={16} />
        {ADMIN_AUTH_COPY.signOut}
      </button>
    </div>
  );
}


function AdminSidebarNavigation() {
  const { isPlatformAdmin } = useAuthentication();

  // Pending college-application count for the badge on that item. One fetch when
  // the rail mounts for a platform admin — no polling, and a failure just means
  // no badge.
  const [pendingApplicationCount, setPendingApplicationCount] = useState(0);
  useEffect(() => {
    if (!isPlatformAdmin) {
      return undefined;
    }
    let isActive = true;
    apiClient
      .get('/admin/college-applications?status=pending')
      .then((payload) => {
        if (isActive && Array.isArray(payload?.applications)) {
          setPendingApplicationCount(payload.applications.length);
        }
      })
      .catch(() => {});
    return () => {
      isActive = false;
    };
  }, [isPlatformAdmin]);

  // Items flagged platformAdminOnly render only for a platform admin; a section
  // whose items all disappear drops entirely rather than leaving a bare label.
  const visibleSections = ADMIN_SIDEBAR_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.platformAdminOnly || isPlatformAdmin),
  })).filter((section) => section.items.length > 0);

  return (
    <nav
      aria-label="Admin sections"
      className="flex h-full w-65 shrink-0 flex-col overflow-y-auto bg-admin-neutral-ink"
    >
      {/* Wordmark */}
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-admin-surface-white/10 px-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-admin-primary-blue font-admin-display text-[13px] font-bold text-admin-surface-white">
          D
        </span>
        <span className="font-admin-display text-[15px] font-semibold text-admin-surface-white">
          {ADMIN_BRAND_IDENTITY.appName}
        </span>
      </div>

      {/* Global search, relocated from the removed topbar. */}
      <div className="shrink-0 px-3 pt-4">
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-admin-slate-600"
          />
          <input
            type="search"
            aria-label={ADMIN_DASHBOARD_COPY.searchPlaceholder}
            placeholder={ADMIN_DASHBOARD_COPY.searchPlaceholder}
            className="h-9 w-full rounded-md border border-admin-surface-white/10 bg-admin-surface-white/5 pl-9 pr-3 font-admin-body text-[13px] text-admin-surface-white transition-colors placeholder:text-admin-slate-600 focus:border-admin-primary-blue focus:outline-none"
          />
        </div>
      </div>

      <div className="flex flex-col gap-6 px-3 py-5">
        {visibleSections.map((section) => (
          <div key={section.id} className="flex flex-col gap-1">
            <span className="px-4 pb-1 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
              {section.label}
            </span>
            {section.items.map((item) => (
              <NavigationItem
                key={item.id}
                item={item}
                badgeCount={item.showsPendingApplicationCount ? pendingApplicationCount : 0}
              />
            ))}
          </div>
        ))}
      </div>

      <AdminSidebarAccount />
    </nav>
  );
}

export default AdminSidebarNavigation;
