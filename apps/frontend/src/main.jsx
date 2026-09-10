import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The design system loads BEFORE index.css. Redesigned screens read these
// custom properties directly; index.css still carries the Tailwind @theme the
// not-yet-redesigned screens depend on, and the two do not overlap — nothing
// in dedal-tokens.css is a Tailwind token and nothing in index.css defines a
// --surface / --ink / --primary.
import './design/dedal-tokens.css'
import './design/focus.css'
// Page transitions. Loaded after the tokens because every duration in it is a
// --d-* / --ease-* custom property, and after focus.css only for tidiness —
// nothing in it competes with either file. It defines no ordinary selectors at
// all, only ::view-transition-* pseudo-elements, which a browser without the
// View Transitions API never generates. See the header of that file for the
// data-nav-direction mechanism.
import './design/view-transitions.css'
// The /my-certificates grid. Loaded at the root alongside the other design-
// system sheets rather than imported by the screen, so its custom-property
// reads resolve against the tokens above it in the same cascade order the rest
// of the redesigned surface gets.
import './design/certificates-list.css'
// The certificate surface (detail, public verify, coordinator push). Alongside
// the other design-system stylesheets and before index.css, for the same
// reason they are: it is tokens-only and must not be able to lose to a
// heritage Tailwind utility.
import './design/certificate-page.css'
// Terms of Service, Privacy Policy and past-version screens.
import './design/policy-document.css'
// The /notifications feed. A design-system sheet like the two above it, and
// before index.css for the same reason: it is tokens-only and must not be able
// to lose a cascade to a heritage Tailwind utility.
import './design/notifications.css'
// The volunteer scanner. Alongside the other design-system sheets so its
// token reads resolve in the same cascade order the rest of the redesigned
// surface gets, and before index.css so a heritage utility cannot beat it.
import './design/scanner.css'
// The public /for-colleges landing, and the wordmark header the public
// college pages share. A design-system sheet like the ones above it, and before
// index.css so a heritage Tailwind utility cannot beat it.
import './design/for-colleges.css'
// The public college application form, its confirmation and its status page.
// Same reasoning as every sheet above it: tokens-only, and ahead of index.css so
// a heritage Tailwind utility cannot beat it.
import './design/college-onboarding.css'
// The /account page: the two-pane desktop menu and its mobile slide-in panel.
import './design/account.css'
// The /saved grid and the /my-teams composer + roster. Design-system sheets like
// every one above them, and before index.css for the same reason: tokens-only,
// and a heritage Tailwind utility must not be able to beat them.
// The read view of /profile. Same reasoning as every sheet above it.
import './design/profile.css'
import './design/saved-events.css'
import './design/teams.css'
// The shared 8-box invite-code entry, used by /my-teams and by event detail.
import './design/team-code-entry.css'
// The last five participant screens to leave the Heritage palette: the fest
// running order, /explore, the post-join add-ons step, the payment waiting room
// and the coordinator directory. Design-system sheets like every one above
// them, and before index.css for the same reason: tokens-only, and a heritage
// Tailwind utility must not be able to beat them.
import './design/event-schedule.css'
import './design/category-events.css'
import './design/post-join-addons.css'
import './design/payment-processing.css'
import './design/directory.css'
// The coordinator surface: the per-event panel, the scoreboard, round creation,
// the assignment hub, the coordinator event page and the broadcast composer.
// `dop-` throughout. Same reasoning as every sheet above them: tokens-only, and
// ahead of index.css so a heritage Tailwind utility cannot beat them.
import './design/operator-kit.css'
import './design/operator-screens.css'
// The last staff-facing screens to leave the Heritage palette. backstage.css
// (`dbk-`) is the crew access hub, the volunteer assignment hub, the no-access
// screen and the crew-directory fest picker; volunteer.css (`dvl-`) is the
// volunteer dashboard, the single-checkpoint screen and the My hours panel they
// share. Same reasoning as every sheet above them: tokens-only, and ahead of
// index.css so a heritage Tailwind utility cannot beat them.
import './design/backstage.css'
import './design/volunteer.css'
import './index.css'
import App from './App.jsx'

// Apply dark mode immediately on page load (before React renders) so there's
// no flash of light theme. Reads the same localStorage key the Settings toggle uses.
if (window.localStorage.getItem('festpass.pref.darkMode') === 'on') {
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
