/*
 * promotion-destination.test.js
 *
 * Where a tap on a sponsor card goes: its destination URL, else (for a YouTube /
 * Vimeo video) the video on its own site, else its fest, else nowhere.
 *
 * Two cases matter most. A value that is not an http(s) URL must never be
 * opened, or a pasted "javascript:" link becomes a script on tap. And the video
 * must NOT win over a real destination — it is promotional content, not where
 * the sponsor paid to send people.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { openPromotionDestination, resolvePromotionDestination } from './promotion-destination.js';

const YOUTUBE_URL = 'https://youtu.be/dQw4w9WgXcQ';
const WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolvePromotionDestination', () => {
  it('prefers the destination URL over the video and the fest', () => {
    expect(
      resolvePromotionDestination({
        linkUrl: 'https://sponsor.example/offer',
        mediaType: 'video',
        videoUrl: YOUTUBE_URL,
        festSlug: 'saarang',
      }),
    ).toEqual({ kind: 'external', url: 'https://sponsor.example/offer' });
  });

  it('opens the YouTube video when a video promotion has no destination URL', () => {
    expect(
      resolvePromotionDestination({ mediaType: 'video', videoUrl: YOUTUBE_URL, festSlug: 'saarang' }),
    ).toEqual({ kind: 'external', url: WATCH_URL });
  });

  it('does not send a direct video file anywhere by itself', () => {
    expect(
      resolvePromotionDestination({ mediaType: 'video', videoUrl: 'https://cdn.example.com/clip.mp4' }),
    ).toBeNull();
  });

  it('falls back to the fest when there is no destination URL and no linked video', () => {
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
