// account-sections.js
// The account menu, apart from the screen that draws it. Its own module
// because AccountDrawer renders the same list, and a file that exports a
// component plus a constant is not a Fast Refresh boundary.

import {
  BellIcon,
  CertificateIcon,
  PassIcon,
  RegistrationIcon,
  BookmarkIcon,
  TeamIcon,
  CredentialIcon,
  PersonIcon,
  SettingsIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import MyRegistrationsScreen from '../my-registrations/MyRegistrationsScreen.jsx';
import MyPassesScreen from '../my-passes/MyPassesScreen.jsx';
import SavedEventsScreen from '../saved-events/SavedEventsScreen.jsx';
import MyCertificatesScreen from '../my-certificates/MyCertificatesScreen.jsx';
import NotificationsScreen from '../notifications/NotificationsScreen.jsx';
import ProfileScreen from '../profile/ProfileScreen.jsx';
import SettingsScreen from '../settings/SettingsScreen.jsx';
import TeamManagementScreen from '../team-management/TeamManagementScreen.jsx';
import BackstageScreen from '../backstage/BackstageScreen.jsx';

/*
 * One entry per destination. `path` is where a phone goes; `key` is the
 * /account/:section segment a laptop goes to. They are deliberately the same
 * string minus the slash — one name for one place, so a URL never has to be
 * translated in two directions.
 */
export const SECTIONS = [
  {
    key: 'profile',
    label: 'Profile',
    path: '/profile',
    Icon: PersonIcon,
    Screen: ProfileScreen,
  },
  /*
   * THE FIVE ENTRIES THAT USED TO BE BEHIND "My Fests".
   *
   * /my-fests was a menu of destinations, and this pane is now a menu of
   * destinations — so it was a menu inside a menu, which is one tap of nothing
   * on the way to everywhere. Its own header comment said it existed to end
   * exactly that: two menus, neither named after the thing you were looking
   * for. Its rows are lifted up to this level and the screen is gone.
   */
  {
    key: 'my-registrations',
    label: 'Registrations',
    path: '/my-registrations',
    Icon: RegistrationIcon,
    Screen: MyRegistrationsScreen,
    countKey: 'registrations',
  },
  {
    key: 'my-passes',
    label: 'Passes',
    path: '/my-passes',
    Icon: PassIcon,
    Screen: MyPassesScreen,
  },
  {
    key: 'my-certificates',
    label: 'Certificates',
    path: '/my-certificates',
    Icon: CertificateIcon,
    Screen: MyCertificatesScreen,
  },
  {
    key: 'notifications',
    label: 'Notifications',
    path: '/notifications',
    Icon: BellIcon,
    Screen: NotificationsScreen,
    countKey: 'unread',
  },
  {
    key: 'my-teams',
    label: 'Teams',
    path: '/my-teams',
    Icon: TeamIcon,
    Screen: TeamManagementScreen,
  },
  {
    key: 'saved',
    label: 'Saved events',
    path: '/saved',
    Icon: BookmarkIcon,
    Screen: SavedEventsScreen,
  },
  /*
   * Staff only, and filtered out for everyone else rather than shown disabled:
   * a row a participant can never open is a question about the product they
   * cannot answer. `hasStaffAssignment` comes from the auth context, the same
   * source Profile used when this row lived there.
   */
  {
    key: 'backstage',
    label: 'Backstage',
    path: '/backstage',
    Icon: CredentialIcon,
    Screen: BackstageScreen,
    staffOnly: true,
  },
  {
    key: 'settings',
    label: 'Settings',
    path: '/settings',
    Icon: SettingsIcon,
    Screen: SettingsScreen,
  },
];
