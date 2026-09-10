const crypto = require("crypto");
const { AnonymousSessionModel } = require("../models/anonymous-session-model");

/*
 * Establishes the anonymous session key for a request (see the model for why
 * it exists and why it must expire).
 *
 * THE SERVER ESTABLISHES IT, THE CLIENT ONLY ECHOES IT. A request arriving
 * without a key, or with one that is unknown or expired, is given a fresh
 * one; a request carrying a live key keeps it. The client's only job is to
 * send back whatever it was last given. Nothing the client sends is trusted
 * as a key unless the server minted it and it has not expired — so a client
 * cannot choose its own subject, and a stale key cannot be revived.
 *
 * FIXED WINDOW, NOT SLIDING: the expiry is set once at mint and never moved.
 */
const ANONYMOUS_SESSION_TTL_SECONDS = 4 * 60 * 60;
const KEY_BYTES = 24;
const KEY_PATTERN = /^[A-Za-z0-9_-]{32}$/;

function mintKey() {
  return crypto.randomBytes(KEY_BYTES).toString("base64url");
}

async function establishAnonymousSession(presentedKey, now = new Date()) {
  if (typeof presentedKey === "string" && KEY_PATTERN.test(presentedKey)) {
    const existing = await AnonymousSessionModel.findOne({
      key: presentedKey,
      expiresAt: { $gt: now },
    }).lean();
    if (existing) {
      return { key: existing.key, expiresAt: existing.expiresAt, isNew: false };
    }
  }
  const session = await AnonymousSessionModel.create({
    key: mintKey(),
    expiresAt: new Date(now.getTime() + ANONYMOUS_SESSION_TTL_SECONDS * 1000),
  });
  return { key: session.key, expiresAt: session.expiresAt, isNew: true };
}

module.exports = { establishAnonymousSession, ANONYMOUS_SESSION_TTL_SECONDS, KEY_PATTERN };
