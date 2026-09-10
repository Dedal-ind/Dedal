const jsonwebtoken = require("jsonwebtoken");
const { applicationConfig } = require("../config/application-config");

function createAuthenticationToken(user) {
  const payload = {
    userId: user.id,
    emailAddress: user.emailAddress,
  };

  return jsonwebtoken.sign(payload, applicationConfig.jwtSecret, {
    algorithm: "HS256",
    expiresIn: `${applicationConfig.jwtExpiryDays}d`,
  });
}

/*
 * Pinning algorithms here is what stops a token signed with alg:none — or with
 * an asymmetric algorithm whose "key" is our public secret — from verifying.
 */
function verifyAuthenticationToken(authenticationToken) {
  return jsonwebtoken.verify(authenticationToken, applicationConfig.jwtSecret, {
    algorithms: ["HS256"],
  });
}

module.exports = { createAuthenticationToken, verifyAuthenticationToken };
