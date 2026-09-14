/*
 * playable-video.test.js
 *
 * Only an uploaded video file plays. Everything else — a link to a video site,
 * a page, a relative path, a non-http scheme — is not a video.
 */
import { describe, it, expect } from 'vitest';
import { isPlayableVideoUrl } from './playable-video.js';

describe('isPlayableVideoUrl', () => {
  it('accepts an uploaded MP4, WebM or MOV file, whatever the case or query string', () => {
    expect(isPlayableVideoUrl('https://bucket.s3.amazonaws.com/uploads/abc123.mp4')).toBe(true);
    expect(isPlayableVideoUrl('https://cdn.example.com/clip.WEBM')).toBe(true);
    expect(isPlayableVideoUrl('https://cdn.example.com/clip.mov?X-Amz-Signature=abc')).toBe(true);
    expect(isPlayableVideoUrl('http://localhost:4000/uploads/clip.mp4')).toBe(true);
  });

  it('refuses a link to a video site page', () => {
    expect(isPlayableVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
    expect(isPlayableVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(false);
  });

  it('refuses anything that is not an absolute http(s) URL to a video file', () => {
    expect(isPlayableVideoUrl('https://cdn.example.com/clip')).toBe(false);
    expect(isPlayableVideoUrl('https://cdn.example.com/poster.jpg')).toBe(false);
    expect(isPlayableVideoUrl('/uploads/clip.mp4')).toBe(false);
    expect(isPlayableVideoUrl('javascript:alert(1)//.mp4')).toBe(false);
    expect(isPlayableVideoUrl('')).toBe(false);
    expect(isPlayableVideoUrl(null)).toBe(false);
  });
});
