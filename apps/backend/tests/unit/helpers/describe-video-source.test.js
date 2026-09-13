/*
 * describe-video-source.test.js
 *
 * The one function that decides whether a promotion's videoUrl is a direct file
 * (native <video>) or a YouTube / Vimeo link (provider embed). The backend
 * validator, both participant renderers and both admin forms ask it, so a wrong
 * answer here breaks all of them the same way at once.
 *
 * The cases that matter are the ones that look plausible and are not playable:
 * a YouTube channel page, a Vimeo showcase, a truncated id. Those must come back
 * INVALID, not DIRECT — a DIRECT answer would send them straight into a <video>
 * element, which is exactly the bug this function exists to end.
 */
import { describe, it, expect } from "vitest";
/* Named imports: under vitest the package resolves to its ESM entry, which
   re-exports these by name and has no default export. */
import { describeVideoSource, isLinkedVideoSource, VIDEO_SOURCE_KINDS } from "@dedal/shared";

const VIDEO_ID = "dQw4w9WgXcQ";

describe("describeVideoSource", () => {
  it("returns null for an empty value", () => {
    expect(describeVideoSource("")).toBeNull();
    expect(describeVideoSource("   ")).toBeNull();
    expect(describeVideoSource(null)).toBeNull();
  });

  it.each([
    `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    `https://youtube.com/watch?v=${VIDEO_ID}&t=42s`,
    `https://m.youtube.com/watch?v=${VIDEO_ID}`,
    `https://youtu.be/${VIDEO_ID}`,
    `https://www.youtube.com/shorts/${VIDEO_ID}`,
    `https://www.youtube.com/embed/${VIDEO_ID}`,
    `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`,
  ])("recognises the YouTube link %s", (url) => {
    const source = describeVideoSource(url);

    expect(source.kind).toBe(VIDEO_SOURCE_KINDS.YOUTUBE);
    expect(source.videoId).toBe(VIDEO_ID);
    expect(source.thumbnailUrl).toBe(`https://img.youtube.com/vi/${VIDEO_ID}/maxresdefault.jpg`);
    expect(source.fallbackThumbnailUrl).toBe(`https://img.youtube.com/vi/${VIDEO_ID}/hqdefault.jpg`);
    expect(source.watchUrl).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
  });

  it.each([
    "https://www.youtube.com/@somechannel",
    "https://www.youtube.com/results?search_query=fest",
    "https://www.youtube.com/watch?v=tooShort",
    "https://youtu.be/",
  ])("marks the YouTube page that names no video as invalid: %s", (url) => {
    expect(describeVideoSource(url).kind).toBe(VIDEO_SOURCE_KINDS.INVALID);
  });

  it.each([
    ["https://vimeo.com/76979871", "76979871"],
    ["https://vimeo.com/channels/staffpicks/76979871", "76979871"],
    ["https://player.vimeo.com/video/76979871", "76979871"],
  ])("recognises the Vimeo link %s", (url, videoId) => {
    const source = describeVideoSource(url);

    expect(source.kind).toBe(VIDEO_SOURCE_KINDS.VIMEO);
    expect(source.videoId).toBe(videoId);
    /* Vimeo has no id-derived thumbnail; the creative's poster is used. */
    expect(source.thumbnailUrl).toBeNull();
  });

  it("marks a Vimeo page with no numeric id as invalid", () => {
    expect(describeVideoSource("https://vimeo.com/showcase").kind).toBe(VIDEO_SOURCE_KINDS.INVALID);
  });

  it("treats any other http(s) host as a direct file", () => {
    const source = describeVideoSource("https://cdn.example.com/promos/clip.mp4");

    expect(source.kind).toBe(VIDEO_SOURCE_KINDS.DIRECT);
    expect(isLinkedVideoSource(source)).toBe(false);
  });

  it("marks a non-URL or a non-http scheme as invalid", () => {
    expect(describeVideoSource("clip.mp4").kind).toBe(VIDEO_SOURCE_KINDS.INVALID);
    expect(describeVideoSource("ftp://example.com/clip.mp4").kind).toBe(VIDEO_SOURCE_KINDS.INVALID);
  });

  it("does not mistake a lookalike host for YouTube", () => {
    /* notyoutube.com ends in "youtube.com" as a string but is not a subdomain. */
    expect(describeVideoSource(`https://notyoutube.com/watch?v=${VIDEO_ID}`).kind).toBe(
      VIDEO_SOURCE_KINDS.DIRECT
    );
  });

  it("describes a linked video with no embed URL at all", () => {
    /* YouTube's embed cannot be made clean, so nothing in the app embeds it:
       the descriptor carries a thumbnail and a watch URL, and that is all. */
    const source = describeVideoSource(`https://www.youtube.com/embed/${VIDEO_ID}`);

    expect(isLinkedVideoSource(source)).toBe(true);
    expect(source).not.toHaveProperty("embedUrl");
    expect(source.watchUrl).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
  });
});
