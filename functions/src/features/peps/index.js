const materiales = require("./materiales");
const stock = require("./stock");
const racks = require("./racks");
const utils = require("./utils");

const PEPS = {
  ...materiales,
  ...stock,
  ...racks,
  ...utils,
};

if (typeof global !== "undefined") {
  global.PEPS = PEPS;
}

module.exports = PEPS;
