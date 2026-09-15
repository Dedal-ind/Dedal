import { describe, it, expect } from 'vitest';
import { selectHero } from './select-hero.js';

const NOW = new Date('2026-09-16T00:00:00Z').getTime();
const VIDEO = { id: 'v', mediaType: 'video', videoUrl: 'https://s3.example.com/a.mp4', imageUrl: null };
const IMAGE = { id: 'i', mediaType: 'image', imageUrl: 'https://cdn.example.com/a.jpg' };
const upcoming = (extra = {}) => ({ festSlug: 'next', startsOn: '2026-09-17', endsOn: '2026-09-18', ...extra });

describe('selectHero', () => {
  it('gives an upcoming fest with no media the hero to a video promotion', () => {
    expect(selectHero([upcoming()], [IMAGE, VIDEO], NOW)).toEqual({ kind: 'promotion', promotion: VIDEO });
  });

  it('keeps an upcoming fest that has a poster', () => {
    const fest = upcoming({ bannerImageUrl: 'https://cdn.example.com/p.jpg' });
    expect(selectHero([fest], [VIDEO], NOW)).toEqual({ kind: 'fest', fest, isLive: false });
  });

  it('always keeps a live fest, media or not', () => {
    const fest = { festSlug: 'live', startsOn: '2026-09-15', endsOn: '2026-09-17' };
    expect(selectHero([fest], [VIDEO], NOW).kind).toBe('fest');
  });

  it('keeps a media-less upcoming fest when no promotion has media', () => {
    expect(selectHero([upcoming()], [{ id: 'x', mediaType: 'video', videoUrl: null }], NOW).kind).toBe('fest');
  });
});
