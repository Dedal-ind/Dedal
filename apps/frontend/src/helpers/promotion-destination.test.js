/*
 * promotion-destination.test.js
 *
 * Where a tap on a sponsor card goes: its destination URL, else its fest, else
 * nowhere. The creative's media is never where a tap goes.
 *
 * A value that is not an http(s) URL must never be opened, or a pasted
 * "javascript:" link becomes a script on tap.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { openPromotionDestination, resolvePromotionDestination } from './promotion-destination.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolvePromotionDestination', () => {
  it('prefers the destination URL over the fest', () => {
    expect(
      resolvePromotionDestination({
        linkUrl: 'https://sponsor.example/offer',
        mediaType: 'video',
        videoUrl: 'https://cdn.example.com/clip.mp4',
        festSlug: 'saarang',
      }),
    ).toEqual({ kind: 'external', url: 'https://sponsor.example/offer' });
  });

  it('never sends a video creative to its video, file or link', () => {
    expect(
      resolvePromotionDestination({ mediaType: 'video', videoUrl: 'https://cdn.example.com/clip.mp4' }),
    ).toBeNull();
    expect(
      resolvePromotionDestination({ mediaType: 'video', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }),
    ).toBeNull();
    expect(
      resolvePromotionDestination({
        mediaType: 'video',
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        festSlug: 'saarang',
      }),
    ).toEqual({ kind: 'fest', festSlug: 'saarang' });
  });

  it('falls back to the fest when there is no destination URL', () => {
    expect(resolvePromotionDestination({ linkUrl: null, festSlug: 'saarang' })).toEqual({
      kind: 'fest',
      festSlug: 'saarang',
    });
    expect(resolvePromotionDestination({ fest: { festSlug: 'riviera' } })).toEqual({
      kind: 'fest',
      festSlug: 'riviera',
    });
  });

  it('ignores a destination that is not an http(s) URL', () => {
    expect(resolvePromotionDestination({ linkUrl: 'javascript:alert(1)' })).toBeNull();
    expect(resolvePromotionDestination({ linkUrl: '/fests/saarang', festSlug: 'saarang' })).toEqual({
      kind: 'fest',
      festSlug: 'saarang',
    });
  });

  it('returns null when there is nowhere to go', () => {
    expect(resolvePromotionDestination({})).toBeNull();
    expect(resolvePromotionDestination(null)).toBeNull();
  });
});

describe('openPromotionDestination', () => {
  it('opens an external destination in a new tab without handing over the opener', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    openPromotionDestination({ kind: 'external', url: 'https://sponsor.example' }, vi.fn());

    expect(open).toHaveBeenCalledWith('https://sponsor.example', '_blank', 'noopener,noreferrer');
  });

  it('routes a fest destination inside the app', () => {
    const onOpenFest = vi.fn();

    openPromotionDestination({ kind: 'fest', festSlug: 'saarang' }, onOpenFest);

    expect(onOpenFest).toHaveBeenCalledWith('saarang');
  });

  it('does nothing without a destination', () => {
    const onOpenFest = vi.fn();

    openPromotionDestination(null, onOpenFest);

    expect(onOpenFest).not.toHaveBeenCalled();
  });
});
