const devService = require("../services/dev-service");

async function getSwitchableUsers(request, response) {
  const users = await devService.listSwitchableUsers();
  return response.status(200).json({ data: users });
}

async function postLoginAs(request, response) {
  const result = await devService.loginAs(request.body?.emailAddress);
  return response.status(200).json({ data: result });
}

module.exports = { getSwitchableUsers, postLoginAs };
