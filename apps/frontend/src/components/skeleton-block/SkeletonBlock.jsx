// SkeletonBlock.jsx
// A single placeholder block used to build content-shaped skeleton loaders while
// data is in flight. Heritage Institutional: a soft surface-container fill with
// rounded corners and a subtle pulse — no borders, so the loading state reads as
// the shape of what is coming without shouting.

function SkeletonBlock({ className = '' }) {
  return (
    <div className={['animate-pulse rounded-xl bg-surface-container', className].join(' ')} />
  );
}

export default SkeletonBlock;
