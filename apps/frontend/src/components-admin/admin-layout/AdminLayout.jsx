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

import { Outlet } from 'react-router-dom';
import AdminSidebarNavigation from '../admin-sidebar-navigation/AdminSidebarNavigation.jsx';

function AdminLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-admin-surface-off-white">
      <AdminSidebarNavigation />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AdminLayout;
