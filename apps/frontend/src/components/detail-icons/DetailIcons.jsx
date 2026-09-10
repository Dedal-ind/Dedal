// DetailIcons.jsx
// The icon set for the two detail screens, and the reason it exists.
//
// Both screens used to render Material Symbols LIGATURES — the literal string
// "share" or "call" in a <span>, swapped for a glyph by a webfont loaded from
// Google. Three things went wrong with that, all of them visible: before the
// font arrived the page showed the words; where the font is blocked it showed
// them permanently; and a ligature cannot inherit a stroke weight, so every
// glyph sat at a different optical weight from the text beside it.
//
// These are real SVGs from lucide-react — already a dependency of this repo
// (the admin console uses it), so nothing new was installed. Wrapping them here
// rather than importing lucide directly in each screen keeps one size and one
// stroke weight for the whole surface: 1.8, matching the app header's hand-drawn
// marks, so the two do not read as two different icon sets on one screen.

import {
  AlarmClock,
  ArrowLeft,
  Award,
  BedDouble,
  Bell,
  Bookmark,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Copy,
  Download,
  DoorOpen,
  FileText,
  Flashlight,
  Globe,
  GraduationCap,
  IdCard,
  Info,
  Keyboard,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Moon,
  Package,
  Phone,
  QrCode,
  RefreshCw,
  ScrollText,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Share2,
  Shirt,
  ShoppingBag,
  Star,
  Smartphone,
  Sun,
  Ticket,
  TriangleAlert,
  Trash2,
  Trophy,
  Upload,
  UserRound,
  Gauge,
  Users,
  UtensilsCrossed,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';

/*
 * One wrapper, so a caller picks a SIZE rather than a pixel number: `sm` for a
 * glyph riding beside 11px meta text, the default beside body text, `lg` for a
 * control that is its own tap target.
 */
const SIZES = { sm: 16, md: 20, lg: 24 };

function icon(LucideIcon) {
  return function Icon({ size = 'md', className = '', filled = false }) {
    const pixels = SIZES[size] ?? SIZES.md;
    return (
      <LucideIcon
        width={pixels}
        height={pixels}
        strokeWidth={1.8}
        className={className}
        fill={filled ? 'currentColor' : 'none'}
        aria-hidden="true"
        focusable="false"
      />
    );
  };
}

export const BackIcon = icon(ArrowLeft);
export const ShareIcon = icon(Share2);
export const BookmarkIcon = icon(Bookmark);
export const VenueIcon = icon(MapPin);
export const DateIcon = icon(CalendarDays);
export const PhoneIcon = icon(Phone);
export const MailIcon = icon(Mail);
export const PassIcon = icon(Ticket);
export const TeamIcon = icon(Users);
export const ChevronIcon = icon(ChevronRight);
export const ExpandIcon = icon(ChevronDown);
export const RetryIcon = icon(RefreshCw);
export const OfflineIcon = icon(WifiOff);

/*
 * THE PASS SET — one icon per entitlement type, plus the furniture the pass
 * screen needs. Appended rather than woven in above: everything before this
 * point is the detail-screen set and is imported by screens this addition does
 * not touch.
 *
 * There are SEVEN entitlement types in pass-constants.js, not the three the
 * pass screen used to know about, and an entitlement that renders no icon
 * reads as a broken row rather than an unfamiliar one — hence
 * EntitlementFallbackIcon, which is what an eighth type added next year gets
 * until someone chooses better.
 */
export const GateIcon = icon(DoorOpen);
export const OfferIcon = icon(ShoppingBag);
export const MealIcon = icon(UtensilsCrossed);
export const StayIcon = icon(BedDouble);
export const MerchIcon = icon(Shirt);
export const PrizeIcon = icon(Trophy);
export const EntitlementFallbackIcon = icon(Package);

export const CheckCircleIcon = icon(CircleCheck);
export const BrightnessIcon = icon(Sun);
export const DismissIcon = icon(X);
export const MobileIcon = icon(Smartphone);

/*
 * Added for the authentication surface. AlertIcon is the mark beside a rejected
 * OTP or a refused sign-in — the one place on that surface where an icon is
 * allowed to be --primary, because there it is reporting an error rather than
 * decorating a line. SignOutIcon is the single mark on /sign-out.
 */
export const AlertIcon = icon(TriangleAlert);
export const SignOutIcon = icon(LogOut);

/*
 * THE SETTINGS / PROFILE HUB SET. Appended for the participant Settings and
 * Profile redesign, which was the last participant surface still rendering
 * Material Symbols ligatures — 13 of them across three screens. Every mark
 * below replaces one of those spans, so this block is a deletion elsewhere
 * rather than a new decoration budget.
 *
 * They are deliberately NOT used on every settings row. A list of rows where
 * each row carries a glyph is a list where the glyphs stop meaning anything;
 * these are for the places an icon does work the label cannot — a destination
 * in the quick-access list, the camera on the avatar, the lock on a field that
 * cannot be edited, the bin on the one destructive control.
 */
export const AvatarEditIcon = icon(Camera);
export const UploadIcon = icon(Upload);
export const LockIcon = icon(Lock);
export const TrashIcon = icon(Trash2);
export const BellIcon = icon(Bell);
export const AlarmIcon = icon(AlarmClock);
export const SettingsIcon = icon(Settings);
export const PersonIcon = icon(UserRound);
export const RegistrationIcon = icon(FileText);
export const CertificateIcon = icon(Award);
export const CredentialIcon = icon(IdCard);
export const QrIcon = icon(QrCode);
export const TermsIcon = icon(ScrollText);
export const PrivacyIcon = icon(ShieldCheck);
export const InfoIcon = icon(Info);
export const CollegeIcon = icon(GraduationCap);
export const LanguageIcon = icon(Globe);
export const DarkModeIcon = icon(Moon);
export const WifiIcon = icon(Wifi);

/*
 * THE CERTIFICATES SET. Three marks, one per tone in
 * helpers/certificate-presentation.js, plus the verifiable glyph.
 *
 * Aliases over existing lucide imports rather than new glyphs, deliberately:
 * the certificate grid, the certificate card and the public verify page all
 * read the same tone helper, and a trophy that is a different trophy on one of
 * the three is exactly the inconsistency that helper exists to prevent. The
 * names are the TONE, not the picture, so a future change of glyph is one line
 * here instead of a search across three screens.
 */
export const WinnerToneIcon = icon(Trophy);
export const ParticipationToneIcon = icon(CircleCheck);
export const StaffToneIcon = icon(Star);
export const VerifiableIcon = icon(QrCode);

/*
 * ── The certificate surface ────────────────────────────────────────────────
 *
 * Appended for the certificate detail, public verify and coordinator push
 * screens.
 */
export const CopyIcon = icon(Copy);
export const CheckIcon = icon(Check);
export const DownloadIcon = icon(Download);
/*
 * THE ONE HAND-DRAWN MARK IN THIS FILE.
 *
 * lucide-react 1.x REMOVED every brand icon, so there is no `Linkedin` export
 * to wrap — importing one is a hard module error, not a missing glyph. Rather
 * than pull in a second icon package for a single mark, it is drawn here.
 *
 * It is a FILLED path, which breaks this file's stroke-1.8 rule on purpose: a
 * company mark is a logo, and an outlined approximation of a logo reads as a
 * bad copy of it rather than as a lighter version. It is drawn on lucide's own
 * 24-unit grid and sized through the same SIZES table, so it still matches its
 * neighbours in box and in colour — it inherits `currentColor` like the rest.
 */
export function LinkedInIcon({ size = 'md', className = '' }) {
  const pixels = SIZES[size] ?? SIZES.md;
  return (
    <svg
      width={pixels}
      height={pixels}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.5h4v11H3v-11Z" />
      <path d="M9.5 9.5h3.83v1.5h.06a4.2 4.2 0 0 1 3.78-2.08c4.04 0 4.79 2.66 4.79 6.12v6.46h-4v-5.73c0-1.37-.02-3.13-1.9-3.13-1.9 0-2.2 1.49-2.2 3.03v5.83h-4v-11Z" />
    </svg>
  );
}
export const SearchIcon = icon(Search);
export const SendIcon = icon(Send);
export const CloseIcon = icon(X);

/*
 * The volunteer scanner. APPENDED, not woven in: this file is shared and the
 * exports above are load-bearing for screens this change does not own.
 *
 * Torch is Flashlight rather than a lightning bolt — the bolt in this set
 * already means "live"/energy on the event cards, and a volunteer reading it
 * as anything other than "turn the light on" at a dark gate is a tap wasted.
 * Keyboard is the backup-code entry: the fallback when a QR will not read is
 * literally typing, and a dialpad glyph implies a phone number.
 */
export const TorchIcon = icon(Flashlight);
export const KeypadIcon = icon(Keyboard);
export const SoundOnIcon = icon(Volume2);
export const SoundOffIcon = icon(VolumeX);

/*
 * The notifications feed. APPENDED, like the block above, and with its OWN
 * import statement rather than additions to the list at the top of the file —
 * that list is shared and being edited by other work in flight, and an import
 * declaration is hoisted wherever it is written, so this is the same module
 * graph with none of the collision surface.
 *
 * Seven server notificationTypes, five glyphs. The ranking the feed needs is
 * achievement-versus-information, not seven distinguishable pictures: a wall of
 * seven icons is seven things to learn, and nobody learns them.
 *
 * NotificationRemovedIcon is CalendarX, not the MapPin the older frame used for
 * a location edit. `eventRemoved` is not a venue change — the event is off the
 * schedule entirely — and CalendarX pairs with the Calendar on roundStarted so
 * the same glyph family carries both "this is on" and "this is off".
 */
import { Calendar, CalendarX, Megaphone, Target, Trash } from 'lucide-react';

export const NotificationResultIcon = icon(Trophy);
export const NotificationCertificateIcon = icon(Award);
export const NotificationScheduleIcon = icon(Calendar);
export const NotificationBroadcastIcon = icon(Megaphone);
export const NotificationOutcomeIcon = icon(Target);
export const NotificationRemovedIcon = icon(CalendarX);
export const NotificationDeleteIcon = icon(Trash);

/*
 * ── The public /for-colleges landing ──────────────────────────────────────
 *
 * Four marks for the four things a college is actually buying, plus the scroll
 * cue. Imported in their own statement, as the notification block above does,
 * so the set can be read as a group.
 *
 * Only two glyphs are new: passes reuse QrIcon and certificates reuse
 * CertificateIcon, because they are the same two products this app already
 * draws that way everywhere else and a marketing page that invents its own
 * icons for them teaches the reader something they then have to unlearn.
 * Shield, not ShieldCheck: staff access is a permission boundary, not a
 * verified state, and the tick already means "genuine" on the certificate
 * screens.
 */
import { Shield, UserCheck } from 'lucide-react';

export const RegistrationsFeatureIcon = icon(UserCheck);
export const StaffAccessFeatureIcon = icon(Shield);

/*
 * The public college-onboarding surface (/register-college, its success page
 * and its status page). APPENDED with its OWN import statement, following the
 * block above and for the same reason: the list at the top of this file is
 * shared and being edited by other work in flight, and an import declaration is
 * hoisted wherever it is written.
 *
 * ONE new glyph. The status page's "application received" state needs a clock —
 * the only one of the four states whose meaning is "nothing has happened yet,
 * and that is fine". Every other icon that surface needs (copy, check, close,
 * info, upload, chevron, alert) is already exported above, and reusing them is
 * what keeps this from becoming a second icon set at a second stroke weight.
 */
import { Clock } from 'lucide-react';

export const ClockIcon = icon(Clock);

/*
 * ── /saved and /my-teams ──────────────────────────────────────────────────
 *
 * APPENDED with its own import statement, exactly like the four blocks above
 * it, and for the same reason: the list at the top of this file is shared and
 * an import declaration is hoisted wherever it is written.
 *
 * FIVE new glyphs, and only five. Everything else these two screens need is
 * already exported above — BookmarkIcon, TeamIcon, LockIcon, CopyIcon,
 * CheckIcon, ExpandIcon, DateIcon, VenueIcon, OfflineIcon, AlertIcon — and
 * reusing them is what stops /saved from teaching a reader a second picture for
 * a bookmark.
 *
 * BookmarkX rather than a filled Bookmark for the unsave control. The saved
 * list is a screen where EVERY card is already saved, so a filled bookmark
 * states a fact nobody needed stated; the button's job there is "take this
 * out", and the crossed mark is the only one of the two that says so.
 *
 * Crown, not Star, for the captain. Star is already spoken for by
 * StaffToneIcon on the certificate surface and by the team LEADER — the person
 * who created the team — and captain and leader are genuinely different posts
 * that can be held by different people on the same roster. Two roles on one
 * card need two marks or the card is lying.
 *
 * Compass for the empty state's way out: it leads to browsing, not to a
 * search box, and the magnifier already means search in the app header.
 */
import { BookmarkX, Compass, Crown, Plus, UserRoundPlus } from 'lucide-react';

export const UnsaveIcon = icon(BookmarkX);
export const BrowseIcon = icon(Compass);
export const CreateTeamIcon = icon(Plus);
export const JoinTeamIcon = icon(UserRoundPlus);
export const CaptainIcon = icon(Crown);

/*
 * ── The last legacy participant screens ───────────────────────────────────
 *
 * /schedule/:festId, /explore, the post-join add-ons step, the payment waiting
 * room and the coordinator directory. APPENDED with its OWN import statement,
 * exactly like the blocks above it, and for the same reason: the list at the
 * top of this file is shared, another migration may be editing it, and an
 * import declaration is hoisted wherever it is written.
 *
 * FOUR new glyphs. Everything else those five screens need is already exported
 * above — ClockIcon, VenueIcon, PhoneIcon, MailIcon, TeamIcon, PersonIcon,
 * CollegeIcon, ExpandIcon, ChevronIcon, SearchIcon, CloseIcon, LockIcon,
 * RetryIcon, OfflineIcon and NotificationBroadcastIcon — and reusing them is
 * the whole point of the file.
 *
 * `Plus` is aliased on import because it is already bound at module scope by
 * the /my-teams block above (as CreateTeamIcon); two statements may import the
 * same glyph, but not under the same local name.
 *
 * FilterIcon is SlidersHorizontal, NOT `Filter`: lucide-react 1.42 has no
 * `Filter` export at all, and a missing export here is a hard module error that
 * blanks the app rather than a missing picture. Sliders is also the more honest
 * mark — the panel it opens sets a category AND a sort order, which is two
 * controls, not one funnel.
 *
 * PendingIcon is Hourglass, and it is the ONE mark on the payment waiting room
 * once the poll window has run out. Not AlertIcon: a payment still confirming
 * is not an error, and the whole message of that state is "you have not been
 * charged twice, this is simply slow".
 */
import { Hourglass, Minus, Plus as PlusGlyph, SlidersHorizontal } from 'lucide-react';

export const FilterIcon = icon(SlidersHorizontal);
export const PendingIcon = icon(Hourglass);
export const StepUpIcon = icon(PlusGlyph);
export const StepDownIcon = icon(Minus);

/*
 * Capacity — "42 of 60 seats taken". Gauge, not Users: the row is about how
 * FULL the event is, and it sits beside a progress meter that says the same
 * thing graphically. Users would repeat TeamIcon, which already means "a team"
 * elsewhere on this very page.
 */
export const CapacityIcon = icon(Gauge);
