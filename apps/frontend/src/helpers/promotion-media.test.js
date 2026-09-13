/*
 * promotion-media.test.js
 *
 * Only a direct video file plays in a card, so only it is measured as video. A
 * YouTube thumbnail is an image and must be measured as one — otherwise a
 * sponsor's report counts a still picture as a watched video.
 */
import { describe, it, expect } from 'vitest';
import { viewabilityMediaTypeFor } from './promotion-media.js';

describe('viewabilityMediaTypeFor', () => {
  it('measures a direct video file as video', () => {
    expect(
      viewabilityMediaTypeFor({ mediaType: 'video', videoUrl: 'https://cdn.example.com/clip.mp4' }),
    ).toBe('video');
  });

  it('measures a YouTube or Vimeo link as the image it is shown as', () => {
    expect(
      viewabilityMediaTypeFor({ mediaType: 'video', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }),
    ).toBe('image');
    expect(viewabilityMediaTypeFor({ mediaType: 'video', videoUrl: 'https://vimeo.com/76979871' })).toBe(
      'image',
    );
  });

  it('measures an unplayable video link as an image', () => {
    expect(
      viewabilityMediaTypeFor({ mediaType: 'video', videoUrl: 'https://www.youtube.com/@channel' }),
    ).toBe('image');
  });

  it('measures an image creative, or a video with no URL, as an image', () => {
    expect(viewabilityMediaTypeFor({ mediaType: 'image' })).toBe('image');
    expect(viewabilityMediaTypeFor({ mediaType: 'video', videoUrl: null })).toBe('image');
    expect(viewabilityMediaTypeFor(null)).toBe('image');
  });
});
