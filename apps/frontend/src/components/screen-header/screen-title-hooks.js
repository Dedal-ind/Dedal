// screen-title-hooks.js
// The read side of the screen-title context. Split out of
// screen-title-context.jsx for the same reason as screen-title-store.js.

import { useContext } from 'react';

import { ScreenTitleContext } from './screen-title-store.js';

/*
 * Both hooks tolerate being called outside the provider. ScreenHeader is used
 * by backstage and admin screens too, which are not inside ParticipantLayout;
 * there the registration is simply a no-op rather than a crash.
 */
export function useScreenTitleRegistration() {
  return useContext(ScreenTitleContext)?.registerScreenTitle ?? null;
}

export function useHasScreenTitle() {
  return useContext(ScreenTitleContext)?.hasScreenTitle ?? false;
}
