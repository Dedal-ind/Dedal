// RoleBadge.jsx
// The pill that names who you are signed in as: "College Admin — RVCE",
// "Coordinator — Alliance ONE", "Volunteer". It reads a roleIdentity straight
// from the authentication context and renders nothing for a plain participant —
// a badge saying "Participant" is noise on a screen that is already theirs.
//
// It lives in both design systems, so the `variant` picks which one: 'participant'
// is the dedal participant system (pill, ink and primary tokens)
// and 'admin' is Executive Precision (rounded, tinted, sentence case). Neither
// palette carries a purple or a per-role hue, so the tones below map each role
// to the CLOSEST token that already exists rather than introducing new colours:
// the participant system uses ink for authority and primary for the
// operational roles, and the admin system its blue/amber/green status trio.

const PARTICIPANT_TONES = {
  platformAdmin: 'bg-[var(--ink)] text-white',
  administrator: 'bg-[var(--ink)] text-white',
  coordinator: 'bg-[var(--primary)] text-white',
  volunteer: 'border border-[var(--primary)] text-[var(--primary)]',
};

const ADMIN_TONES = {
  platformAdmin: 'bg-admin-neutral-ink/10 text-admin-neutral-ink',
  administrator: 'bg-admin-primary-blue/10 text-admin-primary-blue',
  coordinator: 'bg-admin-status-warning-amber/10 text-admin-status-warning-amber',
  volunteer: 'bg-admin-status-success-green/10 text-admin-status-success-green',
};

function RoleBadge({ roleIdentity, variant = 'participant', className = '' }) {
  const kind = roleIdentity?.kind;
  if (!kind || kind === 'participant' || !roleIdentity.label) {
    return null;
  }

  const text = roleIdentity.scopeName
    ? `${roleIdentity.label} — ${roleIdentity.scopeName}`
    : roleIdentity.label;

  if (variant === 'admin') {
    return (
      <span
        className={[
          'inline-flex max-w-full items-center truncate rounded-md px-2 py-0.5 font-admin-body text-[12px] font-semibold',
          ADMIN_TONES[kind] ?? ADMIN_TONES.administrator,
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {text}
      </span>
    );
  }

  return (
    <span
      className={[
        'inline-flex max-w-full items-center truncate rounded-pill px-2.5 py-0.5 font-[family-name:var(--font)] text-[10px] font-bold leading-4',
        PARTICIPANT_TONES[kind] ?? PARTICIPANT_TONES.administrator,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {text}
    </span>
  );
}

export default RoleBadge;
