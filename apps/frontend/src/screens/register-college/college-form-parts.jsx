// college-form-parts.jsx
// The repeated furniture of the college application form, split out of
// RegisterCollegeScreen so that file can be about the FLOW — the steps, the
// validation, the submit — rather than about the nineteenth copy of a labelled
// input.
//
// Everything here is presentation. Nothing in this file knows what a college
// application is, validates anything, or talks to the API.

import { ExpandIcon } from '../../components/detail-icons/DetailIcons.jsx';
import { COLLEGE_ONBOARDING_COPY } from '../../brand/brand-copy.js';

/*
 * THE FLOATING-LABEL FIELD.
 *
 * The label starts inside the box where the text will go and rises to a small
 * line at the top once the field is focused or has anything in it — the pattern
 * a college admin has already used on every payment and KYC form they have
 * filled in this year.
 *
 * The raised state is a CLASS, computed here from `value`, rather than the
 * `:placeholder-shown` trick. A <select> has no placeholder for that trick to
 * key off and a third of these fields are selects; one mechanism that works for
 * input, select and textarea alike beats two that disagree at the edges.
 *
 * The error message and the hint are mutually exclusive and share the
 * describedby slot deliberately: while a field is broken, the only thing worth
 * saying about it is what is wrong. Only one of the two is ever in the DOM, so
 * aria-describedby can point at a single stable id.
 */
function DcoField({
  id,
  label,
  value,
  error,
  hint,
  optional = false,
  as = 'input',
  children,
  ...controlProps
}) {
  const describedById = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const isFilled = String(value ?? '').length > 0;
  const Control = as === 'select' ? 'select' : as === 'textarea' ? 'textarea' : 'input';

  const className = [
    'dco-field',
    isFilled ? 'dco-field--filled' : '',
    error ? 'dco-field--error' : '',
    as === 'textarea' ? 'dco-field--area' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const controlClassName = [
    'dco-control',
    as === 'select' ? 'dco-control--select' : '',
    as === 'textarea' ? 'dco-control--area' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className}>
      <span className="dco-field__box">
        <Control
          id={id}
          className={controlClassName}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedById}
          {...controlProps}
        >
          {children}
        </Control>
        {/* A real <label for>, not a styled span: tapping it focuses the field
            and a screen reader reads it as the field's name. */}
        <label className="dco-field__label" htmlFor={id}>
          {label}
          {optional ? (
            <span className="dco-field__optional"> ({COLLEGE_ONBOARDING_COPY.dcoOptional})</span>
          ) : null}
        </label>
        {as === 'select' ? (
          <span className="dco-field__chevron" aria-hidden="true">
            <ExpandIcon size="sm" />
          </span>
        ) : null}
      </span>
      {error ? (
        <span className="dco-field__error" id={`${id}-error`}>
          {error}
        </span>
      ) : hint ? (
        <span className="dco-field__hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/*
 * A single-choice group, as REAL radio inputs inside a real fieldset.
 *
 * The Heritage version was four <button role="radio"> elements, which meant
 * re-implementing arrow-key navigation (it did not) and roving tabindex (it did
 * not). Native radios get both from the browser for free, and the styling is
 * done on the wrapping label, so nothing is lost visually.
 */
function DcoChoiceGroup({ name, legend, value, options, error, onChange }) {
  const errorId = `${name}-error`;
  return (
    <fieldset
      className="dco-choicegroup"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="dco-choicegroup__legend">{legend}</legend>
      <div className="dco-choices">
        {options.map((option) => (
          <label className="dco-choice" key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {error ? (
        <span className="dco-field__error" id={errorId}>
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}

/*
 * A review section: the STEP'S OWN TITLE as the heading — not a second
 * vocabulary — plus the Edit action that jumps back to that step, and the rows.
 *
 * Edit is a text button rather than an icon: it sits in a row of headings on a
 * screen that is otherwise entirely words, and a pencil glyph here would be one
 * more thing to decode for an action whose name is one syllable.
 */
function DcoReviewSection({ title, onEdit, children }) {
  return (
    <section className="dco-review__section">
      <div className="dco-review__head">
        <h3 className="dco-review__title">{title}</h3>
        <button type="button" className="dco-review__edit" onClick={onEdit}>
          {COLLEGE_ONBOARDING_COPY.dcoEdit}
          {/* The section name, for anyone hearing the buttons out of context —
              four identical "Edit"s in a row is no list at all. */}
          <span className="dco-sr">{` ${title}`}</span>
        </button>
      </div>
      <dl className="dco-review__rows">{children}</dl>
    </section>
  );
}

// One key-value row. A real <dt>/<dd> pair inside the section's <dl>, because
// that is exactly what this is; the two-column grid on the <dl> lays them out.
function DcoReviewRow({ label, value }) {
  return (
    <>
      <dt className="dco-review__key">{label}</dt>
      <dd className="dco-review__value">{value || '—'}</dd>
    </>
  );
}

export { DcoField, DcoChoiceGroup, DcoReviewSection, DcoReviewRow };
