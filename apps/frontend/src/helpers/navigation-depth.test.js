import { describe, expect, it } from 'vitest';
import {
  NAVIGATION_DIRECTIONS,
  compareNavigationDirection,
  getNavigationDepth,
} from './navigation-depth.js';

describe('getNavigationDepth', () => {
  it('places the ladder at its declared depths', () => {
    expect(getNavigationDepth('/')).toBe(0);
    expect(getNavigationDepth('/fests/alliance-one-2026')).toBe(1);
    expect(getNavigationDepth('/events/fifth-perspective')).toBe(2);
    expect(getNavigationDepth('/register/6a6774fdc6c3ca0bf74e6731')).toBe(3);
    expect(getNavigationDepth('/checkout/6a6774fdc6c3ca0bf74e6731')).toBe(4);
  });

  it('treats everything off the ladder as a sibling of the feed', () => {
    expect(getNavigationDepth('/profile')).toBe(0);
    expect(getNavigationDepth('/settings')).toBe(0);
    expect(getNavigationDepth('/my-fests')).toBe(0);
    expect(getNavigationDepth('/my-passes/6aa11e64e14c77aa3130124a')).toBe(0);
  });

  it('does not throw on rubbish', () => {
    expect(getNavigationDepth('')).toBe(0);
    expect(getNavigationDepth(undefined)).toBe(0);
    /* A bare /fests with no slug is the collection, not a fest. */
    expect(getNavigationDepth('/fests')).toBe(0);
  });
});

describe('compareNavigationDirection', () => {
  it('reads a descent as forward', () => {
    expect(compareNavigationDirection('/', '/fests/alliance-one-2026', 'PUSH')).toBe(
      NAVIGATION_DIRECTIONS.FORWARD,
    );
    expect(
      compareNavigationDirection('/events/fifth-perspective', '/register/abc', 'PUSH'),
    ).toBe(NAVIGATION_DIRECTIONS.FORWARD);
  });

  it('reads a climb as back even on a PUSH', () => {
    expect(compareNavigationDirection('/events/fifth-perspective', '/', 'PUSH')).toBe(
      NAVIGATION_DIRECTIONS.BACK,
    );
  });

  it('reads siblings as same', () => {
    expect(compareNavigationDirection('/profile', '/settings', 'PUSH')).toBe(
      NAVIGATION_DIRECTIONS.SAME,
    );
    expect(
      compareNavigationDirection('/fests/one', '/fests/two', 'PUSH'),
    ).toBe(NAVIGATION_DIRECTIONS.SAME);
  });

  it('lets POP win over the ladder — the gesture is the signal', () => {
    expect(compareNavigationDirection('/', '/checkout/abc', 'POP')).toBe(
      NAVIGATION_DIRECTIONS.BACK,
    );
  });

  it('treats REPLACE as same — nothing was stacked', () => {
    expect(compareNavigationDirection('/', '/fests/one', 'REPLACE')).toBe(
      NAVIGATION_DIRECTIONS.SAME,
    );
  });
});
