// AdminExecutiveButton.jsx
// Two weights and a quiet one. `primary` is the single blue fill that marks the
// one action a screen wants; `secondary` is white with a hairline for everything
// beside it; `ghost` is for tertiary actions inside dense rows. `danger` exists
// because destructive admin actions must not look like ordinary ones.
//
// Every colour class is admin-namespaced (bg-admin-*, text-admin-*) so this
// button can only ever paint in the Executive Precision palette.

const VARIANT_CLASSES = {
  primary:
    'bg-admin-primary-blue text-admin-surface-white border border-admin-primary-blue hover:bg-admin-primary-blue-dark hover:border-admin-primary-blue-dark',
  secondary:
    'bg-admin-surface-white text-admin-neutral-ink border border-admin-slate-200 hover:bg-admin-surface-off-white',
  ghost: 'bg-transparent text-admin-slate-600 border border-transparent hover:bg-admin-surface-off-white',
  danger:
    'bg-admin-status-error-red text-admin-surface-white border border-admin-status-error-red hover:brightness-95',
};

// Heights are on the 4px grid; `medium` is the default row-and-form size.
const SIZE_CLASSES = {
  small: 'h-8 px-3 text-[13px]',
  medium: 'h-10 px-4 text-[14px]',
  large: 'h-11 px-5 text-[14px]',
};

function AdminExecutiveButton({
  variant = 'primary',
  size = 'medium',
  type = 'button',
  fullWidth = false,
  loading = false,
  disabled = false,
  iconLeft,
  iconRight,
  className = '',
  children,
  ...buttonProps
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-md font-admin-body font-medium',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant] ?? VARIANT_CLASSES.primary,
        SIZE_CLASSES[size] ?? SIZE_CLASSES.medium,
        fullWidth ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...buttonProps}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        iconLeft
      )}
      {children}
      {loading ? null : iconRight}
    </button>
  );
}

export default AdminExecutiveButton;
