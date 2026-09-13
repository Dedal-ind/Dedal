"use strict";

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PROMOTER_KINDS = {
  COLLEGE: "college",
  FEST_ORGANISER: "festOrganiser",
  SPONSOR: "sponsor",
};

const PLACEMENT_KEYS = {
  HOME_CAROUSEL: "homeCarousel",
  FEST_DETAIL: "festDetail",
  POST_REGISTRATION: "postRegistration",
  PASS_SCREEN: "passScreen",
};

const CAMPAIGN_STATUSES = {
  DRAFT: "draft",
  PUBLISHED: "published",
  PAUSED: "paused",
  ARCHIVED: "archived",
};

const CAMPAIGN_PRIORITY_TIERS = {
  PREMIUM: 1,
  STANDARD: 2,
  HOUSE: 3,
};

const CREATIVE_MEDIA_TYPES = {
  IMAGE: "image",
  VIDEO: "video",
};


/*
 * WHAT KIND OF VIDEO A URL IS — the one definition every surface asks.
 *
 * A promotion's videoUrl holds either a direct file (an upload the app serves,
 * played by a native <video>) or a YouTube / Vimeo link (which a <video> cannot
 * play at all — it is a web page, not a media file). Nothing used to tell them apart:
 * the admin form accepted a pasted YouTube link, the participant feed handed it
 * to <video src>, the element errored, and the card silently fell back to its
 * poster. The backend validator, both participant renderers and both admin forms
 * now ask this function, so they cannot disagree about which is which.
 *
 * Returns null for an empty value, or { kind, ... } where kind is one of
 * VIDEO_SOURCE_KINDS. A link on a YouTube or Vimeo host that names no playable
 * video (a channel page, a search, a malformed id) is INVALID, not direct — it
 * would fail in a <video> just as surely, and the admin should be told at save.
 *
 * Derived, not stored: the URL already says what it is, and a separate flag
 * beside it is a second field that can contradict the first.
 */
const VIDEO_SOURCE_KINDS = {
  DIRECT: "direct",
  YOUTUBE: "youtube",
  VIMEO: "vimeo",
  INVALID: "invalid",
};

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_VIDEO_ID_PATTERN = /^\d+$/;

function isHostOrSubdomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function readYouTubeVideoId(url, hostname) {
  const segments = url.pathname.split("/").filter(Boolean);
  if (isHostOrSubdomain(hostname, "youtu.be")) {
    return segments[0] ?? null;
  }
  if (segments[0] === "watch") {
    return url.searchParams.get("v");
  }
  /* /embed/<id>, /shorts/<id>, /live/<id>, /v/<id> */
  if (["embed", "shorts", "live", "v"].includes(segments[0])) {
    return segments[1] ?? null;
  }
  return null;
}

function describeVideoSource(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    return null;
  }

  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { kind: VIDEO_SOURCE_KINDS.INVALID };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: VIDEO_SOURCE_KINDS.INVALID };
  }

  const hostname = url.hostname.toLowerCase();

  const isYouTubeHost = ["youtube.com", "youtu.be", "youtube-nocookie.com"].some((domain) =>
    isHostOrSubdomain(hostname, domain)
  );
  if (isYouTubeHost) {
    const videoId = readYouTubeVideoId(url, hostname);
    if (!videoId || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
      return { kind: VIDEO_SOURCE_KINDS.INVALID, provider: VIDEO_SOURCE_KINDS.YOUTUBE };
    }
    return {
      kind: VIDEO_SOURCE_KINDS.YOUTUBE,
      videoId,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      /*
       * The card image. maxres is the sharpest, but not every video has one;
       * hqdefault always exists. The client tries them in that order — see
       * helpers/video-thumbnail.js for why a missing maxres cannot be detected
       * with onError alone.
       */
      thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      fallbackThumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    };
  }

  if (isHostOrSubdomain(hostname, "vimeo.com")) {
    const segments = url.pathname.split("/").filter(Boolean);
    /* vimeo.com/<id>, vimeo.com/channels/<name>/<id>, player.vimeo.com/video/<id> —
       in every shape the video id is the last all-digit segment. */
    const videoId = [...segments].reverse().find((segment) => VIMEO_VIDEO_ID_PATTERN.test(segment));
    if (!videoId) {
      return { kind: VIDEO_SOURCE_KINDS.INVALID, provider: VIDEO_SOURCE_KINDS.VIMEO };
    }
    return {
      kind: VIDEO_SOURCE_KINDS.VIMEO,
      videoId,
      watchUrl: `https://vimeo.com/${videoId}`,
      /* Vimeo has no id-derived thumbnail URL; it needs an API call, so the
         creative's own poster image is used instead. */
      thumbnailUrl: null,
      fallbackThumbnailUrl: null,
    };
  }

  return { kind: VIDEO_SOURCE_KINDS.DIRECT, url: url.toString() };
}

function isLinkedVideoSource(source) {
  return (
    Boolean(source) &&
    (source.kind === VIDEO_SOURCE_KINDS.YOUTUBE || source.kind === VIDEO_SOURCE_KINDS.VIMEO)
  );
}

module.exports = {
  EMAIL_ADDRESS_PATTERN,
  PROMOTER_KINDS,
  PLACEMENT_KEYS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_PRIORITY_TIERS,
  CREATIVE_MEDIA_TYPES,
  VIDEO_SOURCE_KINDS,
  describeVideoSource,
  isLinkedVideoSource,
};
