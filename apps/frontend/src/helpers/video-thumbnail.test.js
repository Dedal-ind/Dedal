/*
 * video-thumbnail.test.js
 *
 * The order a linked video's images are tried in, and the one detection that
 * cannot be done with onError: YouTube answers a missing maxresdefault.jpg with
 * a 120px placeholder that LOADS successfully.
 */
import { describe, it, expect } from 'vitest';
import { isMissingYouTubeThumbnail, listThumbnailCandidates } from './video-thumbnail.js';

const MAXRES = 'https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg';
const HQ = 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg';

describe('listThumbnailCandidates', () => {
  it('tries maxres, then hq, then the creative poster', () => {
    expect(
      listThumbnailCandidates(
        { thumbnailUrl: MAXRES, fallbackThumbnailUrl: HQ },
        'https://cdn.example.com/poster.jpg',
      ),
    ).toEqual([MAXRES, HQ, 'https://cdn.example.com/poster.jpg']);
  });

  it('falls straight to the poster for a Vimeo video, which has no derived thumbnail', () => {
    expect(
      listThumbnailCandidates({ thumbnailUrl: null, fallbackThumbnailUrl: null }, 'https://cdn.example.com/p.jpg'),
    ).toEqual(['https://cdn.example.com/p.jpg']);
  });

  it('returns nothing when there is nothing to show', () => {
    expect(listThumbnailCandidates(null, null)).toEqual([]);
  });
});

describe('isMissingYouTubeThumbnail', () => {
  it('treats the 120px YouTube placeholder as missing', () => {
    expect(isMissingYouTubeThumbnail(MAXRES, 120)).toBe(true);
  });

  it('accepts a real maxres thumbnail', () => {
    expect(isMissingYouTubeThumbnail(MAXRES, 1280)).toBe(false);
  });

  it('never second-guesses a non-YouTube image, however small', () => {
    expect(isMissingYouTubeThumbnail('https://cdn.example.com/poster.jpg', 100)).toBe(false);
  });

  it('ignores an image whose width is not known yet', () => {
    expect(isMissingYouTubeThumbnail(HQ, 0)).toBe(false);
  });
});
