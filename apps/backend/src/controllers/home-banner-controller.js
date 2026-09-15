const homeBannerService = require("../services/home-banner-service");
const { extractRequestContext } = require("../helpers/request-context");

/*
 * Shorter than the promotions list's five minutes: the admin changing the
 * banner expects to see it on their own phone within the minute, and the
 * payload is five slides at most.
 */
const PUBLIC_CACHE_MAX_AGE_SECONDS = 60;

async function getPublicHomeBanner(request, response) {
  const result = await homeBannerService.getPublicHomeBanner();
  response.setHeader("Cache-Control", `public, max-age=${PUBLIC_CACHE_MAX_AGE_SECONDS}`);
  return response.status(200).json({ data: result });
}

async function getHomeBannerSetting(request, response) {
  const result = await homeBannerService.getHomeBannerSetting();
  return response.status(200).json({ data: result });
}

async function putHomeBannerSetting(request, response) {
  const result = await homeBannerService.updateHomeBannerSetting(
    request.authenticatedUser.userId,
    request.body ?? {},
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

module.exports = { getPublicHomeBanner, getHomeBannerSetting, putHomeBannerSetting };
