/*
 * Parses an Authorization header into its Bearer token, or null when the header
 * is absent or not a well-formed "Bearer <token>". Shared by the authentication
 * and already-signed-in middlewares so both agree, to the character, on what a
 * valid credential header looks like — a check loosened or tightened in one copy
 * can no longer leave one guard accepting what the other refuses.
 *
 * The scheme match is case-insensitive per RFC 6750 section 2.1 ("Bearer",
 * "bearer", and "BEARER" are all well-formed), while every other rule is
 * unchanged: a single space between scheme and token, and a non-empty token.
 */
function extractBearerToken(authorizationHeader) {
  if (typeof authorizationHeader !== "string") {
    return null;
  }
  const [scheme, tokenValue] = authorizationHeader.split(" ");
  if (scheme.toLowerCase() !== "bearer" || !tokenValue) {
    return null;
  }
  return tokenValue;
}

module.exports = { extractBearerToken };
