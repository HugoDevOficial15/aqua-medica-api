const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const logger = require("firebase-functions/logger");

setGlobalOptions({maxInstances: 10});

exports.hello = onRequest((request, response) => {
  logger.info("Función hello ejecutada");

  response.status(200).json({
    ok: true,
    message: "AQUA Médica API funcionando",
  });
});
