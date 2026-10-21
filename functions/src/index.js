const peps = require("./features/peps");
const apiConnector = require("./api/connector");

const apiExports = {
  ...peps,
  ...apiConnector,
};

if (typeof global !== "undefined") {
  global.PEPS = apiExports;
}

module.exports = apiExports;
