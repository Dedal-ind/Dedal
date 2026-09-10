// admin-promotions-api.js
// The promoter and creative admin endpoints, and the two shapes of refusal
// those endpoints answer with that a screen must handle by name rather than
// as a generic error:
//   PROMOTER_NAME_TAKEN             → details names the existing promoter
//   PROMOTER_HAS_PUBLISHED_CAMPAIGNS → details.publishedCampaigns [{ id, name }]
//   CREATIVE_IN_PUBLISHED_CAMPAIGN  → details.publishedCampaigns [{ id, name }]

import apiClient from '../api-client/api-client.js';
import {
  PROMOTER_KINDS as PROMOTER_KINDS_MAP,
  PLACEMENT_KEYS as PLACEMENT_KEYS_MAP,
  CAMPAIGN_STATUSES as CAMPAIGN_STATUSES_MAP,
  CAMPAIGN_PRIORITY_TIERS,
  CREATIVE_MEDIA_TYPES as CREATIVE_MEDIA_TYPES_MAP,
} from '@dedal/shared';

export const PROMOTER_KINDS = [
  { value: PROMOTER_KINDS_MAP.COLLEGE, label: 'College' },
  { value: PROMOTER_KINDS_MAP.FEST_ORGANISER, label: 'Fest organiser' },
  { value: PROMOTER_KINDS_MAP.SPONSOR, label: 'Sponsor' },
];

export function kindLabel(kind) {
  return PROMOTER_KINDS.find((option) => option.value === kind)?.label ?? kind;
}

export const PROMOTER_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Archived' },
];

export const CREATIVE_MEDIA_TYPES = [
  { value: CREATIVE_MEDIA_TYPES_MAP.IMAGE, label: 'Image' },
  { value: CREATIVE_MEDIA_TYPES_MAP.VIDEO, label: 'Video' },
];

export const CAMPAIGN_STATUSES = [
  { value: CAMPAIGN_STATUSES_MAP.DRAFT, label: 'Draft' },
  { value: CAMPAIGN_STATUSES_MAP.PUBLISHED, label: 'Published' },
  { value: CAMPAIGN_STATUSES_MAP.PAUSED, label: 'Paused' },
  { value: CAMPAIGN_STATUSES_MAP.ARCHIVED, label: 'Archived' },
];

export const CAMPAIGN_FLIGHT_STATES = [
  { value: 'live', label: 'Live' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'ended', label: 'Ended' },
];

export const PLACEMENT_OPTIONS = [
  { value: PLACEMENT_KEYS_MAP.HOME_CAROUSEL, label: 'Home carousel' },
  { value: PLACEMENT_KEYS_MAP.FEST_DETAIL, label: 'Fest detail' },
  { value: PLACEMENT_KEYS_MAP.POST_REGISTRATION, label: 'Post-registration' },
  { value: PLACEMENT_KEYS_MAP.PASS_SCREEN, label: 'Pass screen' },
];

export function placementLabel(key) {
  return PLACEMENT_OPTIONS.find((o) => o.value === key)?.label ?? key;
}

export const PRIORITY_TIERS = [
  { value: CAMPAIGN_PRIORITY_TIERS.PREMIUM, label: 'Premium' },
  { value: CAMPAIGN_PRIORITY_TIERS.STANDARD, label: 'Standard' },
  { value: CAMPAIGN_PRIORITY_TIERS.HOUSE, label: 'House' },
];

export function tierLabel(tier) {
  return PRIORITY_TIERS.find((o) => o.value === tier)?.label ?? `Tier ${tier}`;
}

export const REFUSAL_CODES = {
  NAME_TAKEN: 'PROMOTER_NAME_TAKEN',
  PROMOTER_HAS_PUBLISHED: 'PROMOTER_HAS_PUBLISHED_CAMPAIGNS',
  CREATIVE_IN_PUBLISHED: 'CREATIVE_IN_PUBLISHED_CAMPAIGN',
  EDIT_REFUSED: 'CAMPAIGN_EDIT_REFUSED_WHILE_LIVE',
  NOT_PUBLISHABLE: 'CAMPAIGN_NOT_PUBLISHABLE',
  LAST_ACTIVE_CREATIVE: 'CAMPAIGN_LAST_ACTIVE_CREATIVE',
  PLACEMENT_CAP: 'CAMPAIGN_PLACEMENT_CAP_REACHED',
  INVALID_STATE: 'INVALID_CAMPAIGN_STATE',
};

export function isNetworkError(error) {
  return error?.code === 'NETWORK_ERROR';
}

function query(parameters) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const promotersApi = {
  list: (parameters) => apiClient.get(`/promoters${query(parameters)}`),
  get: (promoterId) => apiClient.get(`/promoters/${promoterId}`),
  create: (payload) => apiClient.post('/promoters', payload),
  update: (promoterId, payload) => apiClient.patch(`/promoters/${promoterId}`, payload),
  archive: (promoterId) => apiClient.post(`/promoters/${promoterId}/archive`),
  restore: (promoterId) => apiClient.post(`/promoters/${promoterId}/restore`),
};

export const creativesApi = {
  list: (parameters) => apiClient.get(`/creatives${query(parameters)}`),
  get: (creativeId) => apiClient.get(`/creatives/${creativeId}`),
  create: (payload) => apiClient.post('/creatives', payload),
  update: (creativeId, payload) => apiClient.patch(`/creatives/${creativeId}`, payload),
  archive: (creativeId) => apiClient.post(`/creatives/${creativeId}/archive`),
  restore: (creativeId) => apiClient.post(`/creatives/${creativeId}/restore`),
};

export const campaignsApi = {
  list: (parameters) => apiClient.get(`/campaigns${query(parameters)}`),
  listForPromoter: (promoterId) => apiClient.get(`/campaigns${query({ promoterId, limit: 200 })}`),
  get: (campaignId) => apiClient.get(`/campaigns/${campaignId}`),
  create: (payload) => apiClient.post('/campaigns', payload),
  update: (campaignId, payload) => apiClient.patch(`/campaigns/${campaignId}`, payload),
  remove: (campaignId) => apiClient.delete(`/campaigns/${campaignId}`),
  publish: (campaignId) => apiClient.post(`/campaigns/${campaignId}/publish`),
  pause: (campaignId) => apiClient.post(`/campaigns/${campaignId}/pause`),
  resume: (campaignId) => apiClient.post(`/campaigns/${campaignId}/resume`),
  archive: (campaignId) => apiClient.post(`/campaigns/${campaignId}/archive`),
  attachCreative: (campaignId, payload) => apiClient.post(`/campaigns/${campaignId}/creatives`, payload),
  updateAssociation: (campaignId, creativeId, payload) => apiClient.patch(`/campaigns/${campaignId}/creatives/${creativeId}`, payload),
  detachCreative: (campaignId, creativeId) => apiClient.delete(`/campaigns/${campaignId}/creatives/${creativeId}`),
};

export const targetingApi = {
  options: () => apiClient.get('/targeting/options'),
  estimate: (targeting) => apiClient.post('/targeting/estimate', { targeting }),
  validate: (targeting) => apiClient.post('/targeting/validate', { targeting }),
};

export const deliveryApi = {
  platform: (parameters) => apiClient.get(`/reports/delivery/platform${query(parameters)}`),
  campaign: (campaignId, parameters) => apiClient.get(`/reports/delivery/campaigns/${campaignId}${query(parameters)}`),
  creatives: (campaignId, parameters) => apiClient.get(`/reports/delivery/campaigns/${campaignId}/creatives${query(parameters)}`),
  placement: (placementKey, parameters) => apiClient.get(`/reports/delivery/placements/${placementKey}${query(parameters)}`),
  promoter: (promoterId, parameters) => apiClient.get(`/reports/delivery/promoters/${promoterId}${query(parameters)}`),
};

export function promoterPath(promoterId) {
  return `/admin/system/promoters/${promoterId}`;
}

export function promoterCreativesPath(promoterId) {
  return `/admin/system/promoters/${promoterId}/creatives`;
}

export function campaignPath(campaignId) {
  return `/admin/system/campaigns/${campaignId}`;
}

export function campaignListPath() {
  return '/admin/system/campaigns';
}

/*
 * Live-edit categories: the backend enforces these, but the frontend shows them
 * in advance so an admin does not discover a refusal on save.
 */
export const LIVE_EDIT_FREELY = new Set(['name', 'displayOrder', 'frequencyCap']);
export const LIVE_EDIT_REFUSED = new Set(['promoterId', 'flightStartsAt']);
export const LIVE_EDIT_LOUD = new Set(['targeting', 'placementKeys', 'priorityTier', 'weight', 'pacing']);
