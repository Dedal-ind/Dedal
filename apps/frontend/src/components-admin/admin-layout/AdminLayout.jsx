// AdminLayout.jsx
// The console chrome every authorised screen renders inside: a fixed sidebar
// rail and a scrolling content well. Only the well scrolls — the rail stays put,
// which is what keeps navigation reachable in long tables.
//
// THERE IS NO PAGE HEADER BAR. The rail's highlighted item already says which
// page you are on, so a breadcrumb and title above the content said it a second
// and third time and cost 64px of every screen to do it. What the bar carried
// that was not a repetition — search, notifications, the account — moved into
// the rail itself, where it sits beside the navigation it belongs with.

import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import AdminSidebarNavigation from '../admin-sidebar-navigation/AdminSidebarNavigation.jsx';

function AdminLayout() {
  const { pathname } = useLocation();
  const contentWellRef = useRef(null);

  /*
   * THE CONTENT WELL IS SCROLLED BACK TO THE TOP ON EVERY NAVIGATION, here and
   * not by the global ScrollToTop.
   *
   * ScrollToTop scrolls `window`, and this layout is `h-screen overflow-hidden`
   * — the window never scrolls, the <main> below does. So the global component
   * has always been a no-op inside the console. It went unnoticed because
   * RouteTransition's pathname key was destroying and rebuilding this element
   * on every navigation, which reset the scroll as a side effect of throwing the
   * node away. Now that the shell survives (so the sidebar keeps its scroll),
   * that accident is gone and the reset has to be asked for explicitly —
   * otherwise opening a short page from halfway down a long one would land the
   * admin below its content.
   */
  useEffect(() => {
    if (contentWellRef.current) {
      contentWellRef.current.scrollTop = 0;
    }
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-admin-surface-off-white">
      <AdminSidebarNavigation />
      <div className="flex min-w-0 flex-1 flex-col">
        <main ref={contentWellRef} className="flex-1 overflow-y-auto p-6">
          {/*
            The per-screen remount that RouteTransition's key used to provide for
            the whole console. It lives here so it covers the screens and not the
            rail beside them — including the case the outer key was really for,
            one screen serving a different :promoterId or :campaignId.
          */}
          <div key={pathname}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default AdminLayout;
