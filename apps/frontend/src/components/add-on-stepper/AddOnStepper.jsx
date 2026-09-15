// AddOnStepper.jsx
// The quantity stepper for an add-on's people or days axis.
//
// Shared by the post-join add-ons screen and the join-with-code screen. The
// buttons disable at the bounds rather than clamping silently, the value is
// announced through role="status" + aria-live, and the field is type="text"
// with inputMode="numeric" — NOT type="number", which screen readers do not
// announce as numeric and which brings a spinner nobody wants.
//
// Styled by design/post-join-addons.css (`dpj-stepper*`), imported here so the
// component carries its own look wherever it is drawn.

import { StepDownIcon, StepUpIcon } from '../detail-icons/DetailIcons.jsx';
import '../../design/post-join-addons.css';

function AddOnStepper({ label, value, minimum, maximum, onChange, disabled = false }) {
  function handleTypedValue(rawValue) {
    const digitsOnly = rawValue.replace(/[^0-9]/g, '');
    if (digitsOnly === '') {
      onChange(minimum);
      return;
    }
    const parsed = Number.parseInt(digitsOnly, 10);
    if (parsed >= minimum && parsed <= maximum) {
      onChange(parsed);
    }
  }

  return (
    <div className="dpj-stepper">
      <span className="dpj-stepper__label">{label}</span>
      <div className="dpj-stepper__controls">
        <button
          type="button"
          className="dpj-stepper__button"
          onClick={() => onChange(value - 1)}
          disabled={disabled || value <= minimum}
          aria-label={`Fewer ${label.toLowerCase()}`}
        >
          <StepDownIcon size="sm" />
        </button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          role="status"
          aria-live="polite"
          aria-label={label}
          className="dpj-stepper__value"
          value={value}
          onChange={(changeEvent) => handleTypedValue(changeEvent.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          className="dpj-stepper__button"
          onClick={() => onChange(value + 1)}
          disabled={disabled || value >= maximum}
          aria-label={`More ${label.toLowerCase()}`}
        >
          <StepUpIcon size="sm" />
        </button>
      </div>
    </div>
  );
}

export default AddOnStepper;
