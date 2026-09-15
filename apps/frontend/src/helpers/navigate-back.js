/*
 * Back with a way home. A screen opened cold — a shared link, a refresh, a
 * PWA launch — has no history entry behind it, so navigate(-1) would leave
 * the app. Then go to the given fallback instead.
 */
export function navigateBack(navigate, fallbackPath) {
  if (typeof window !== 'undefined' && window.history.length <= 1) {
    navigate(fallbackPath, { replace: true });
    return;
  }
  navigate(-1);
}
