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

module.exports = {
  EMAIL_ADDRESS_PATTERN,
  PROMOTER_KINDS,
  PLACEMENT_KEYS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_PRIORITY_TIERS,
  CREATIVE_MEDIA_TYPES,
};
