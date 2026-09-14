/*
 * promotion-media.test.js
 *
 * A promotion shows an image or an uploaded video file, nothing else. A video
 * creative pointing at anything other than a file has no media at all — the
 * fallback — and is never measured as a video.
 */
import { describe, it, expect } from 'vitest';
import { resolvePromotionMedia, viewabilityMediaTypeFor } from './promotion-media.js';

const POSTER = 'https://cdn.example.com/poster.jpg';

describe('resolvePromotionMedia', () => {
  it('plays an uploaded video file with its image as the poster', () => {
    expect(
      resolvePromotionMedia({ mediaType: 'video', videoUrl: 'https://cdn.example.com/clip.mp4', imageUrl: POSTER }),
    ).toEqual({ imageUrl: POSTER, videoUrl: 'https://cdn.example.com/clip.mp4', hasMedia: true });
  });

  it('gives a video creative with a YouTube link no media — not even its image', () => {
    expect(
      resolvePromotionMedia({ mediaType: 'video', videoUrl: 'https://youtu.be/dQw4w9WgXcQ', imageUrl: POSTER }),
    ).toEqual({ imageUrl: null, videoUrl: null, hasMedia: false });
  });

  it('gives a video creative with no file no media', () => {
    expect(resolvePromotionMedia({ mediaType: 'video', videoUrl: null })).toEqual({
      imageUrl: null,
      videoUrl: null,
      hasMedia: false,
    });
  });

  it('shows an image creative as its image, and nothing when it has none', () => {
    expect(resolvePromotionMedia({ mediaType: 'image', imageUrl: POSTER })).toEqual({
      imageUrl: POSTER,
      videoUrl: null,
      hasMedia: true,
    });
    expect(resolvePromotionMedia(null)).toEqual({ imageUrl: null, videoUrl: null, hasMedia: false });
  });
});

describe('viewabilityMediaTypeFor', () => {
  it('measures only a playing video file as video', () => {
    expect(
      viewabilityMediaTypeFor({ mediaType: 'video', videoUrl: 'https://cdn.example.com/clip.webm' }),
    ).toBe('video');
    expect(viewabilityMediaTypeFor({ mediaType: 'video', videoUrl: 'https://www.youtube.com/watch?v=abc' })).toBe(
      'image',
    );
    expect(viewabilityMediaTypeFor({ mediaType: 'image' })).toBe('image');
    expect(viewabilityMediaTypeFor(null)).toBe('image');
  });
});
