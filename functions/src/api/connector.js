const {onRequest} = require("firebase-functions/v2/https");
const peps = require("../features/peps");

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:4200",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "https://sii-aqua-medica-465a9.web.app",
  "https://sii-aqua-medica.firebaseapp.com",
];
const API_KEY = process.env.API_KEY || "aqua-medica-dev-key";
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(",")
).split(",").map((value) => value.trim()).filter(Boolean);

function applyCors(req, res) {
  const origin = req.headers.origin;

  if (origin && (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes("*"))) {
    res.set("Access-Control-Allow-Origin", origin);
  } else if (!origin) {
    res.set("Access-Control-Allow-Origin", "*");
  }

  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type,Authorization,X-API-Key");
  res.set("Access-Control-Allow-Credentials", "true");
}

function validateApiKey(req) {
  const keyFromHeader = req.headers["x-api-key"] || req.headers.authorization || "";
  const normalized = String(keyFromHeader).replace(/^Bearer\s+/i, "").trim();

  return Boolean(normalized) && normalized === API_KEY;
}

function getActionPayload(req) {
  if (!req || typeof req !== "object") {
    return {};
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const query = req.query && typeof req.query === "object" ? req.query : {};

  return {
    action: String(body.action || query.action || "").trim(),
    payload: body.data !== undefined ? body.data : body.payload !== undefined ? body.payload : body,
    queryData: query,
  };
}

function createResponse(ok, data, message, statusCode = 200) {
  return {
    ok,
    data,
    message,
    timestamp: new Date().toISOString(),
    statusCode,
  };
}

function buildRequestInput(req, payload) {
  return {
    data: payload && Object.keys(payload).length ? payload : req.query || {},
    auth: req.auth || null,
    headers: req.headers,
  };
}

const apiHealth = onRequest((req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const payload = createResponse(
      true,
      {
        name: "aqua-medica-api",
        environment: process.env.NODE_ENV || "production",
        apiKeyConfigured: Boolean(process.env.API_KEY),
        allowedOrigins: ALLOWED_ORIGINS,
      },
      "Conexión exitosa con el backend AQUA Médica",
  );

  res.status(200).json(payload);
});

const apiGateway = onRequest(async (req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    if (!validateApiKey(req)) {
      res.status(401).json(
          createResponse(
              false,
              null,
              "No autorizado. Envía X-API-Key o Authorization válido.",
              401,
          ),
      );
      return;
    }

    const {action, payload} = getActionPayload(req);

    if (!action) {
      res.status(400).json(
          createResponse(
              false,
              null,
              "Debes indicar el campo action o query.action.",
              400,
          ),
      );
      return;
    }

    const actionHandler = peps[action];
    if (!actionHandler || typeof actionHandler !== "function") {
      res.status(404).json(
          createResponse(false, null, `La acción '${action}' no existe.`, 404),
      );
      return;
    }

    const result = await actionHandler(buildRequestInput(req, payload));
    const httpResponse = result && typeof result === "object" && "ok" in result ?
      result :
      createResponse(true, result, "Acción ejecutada correctamente");

    res.status(200).json(httpResponse);
  } catch (error) {
    res.status(500).json(
        createResponse(
            false,
            null,
            error.message || "Error ejecutando la acción solicitada.",
            500,
        ),
    );
  }
});

const apiTestConnection = onRequest((req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const status = validateApiKey(req) ?
    createResponse(
        true,
        {connected: true, backend: "aqua-medica-api"},
        "La otra app logró conectarse al backend.",
    ) :
    createResponse(
        false,
        {connected: false, backend: "aqua-medica-api"},
        "La otra app no tiene autorización válida.",
        401,
    );

  res.status(status.statusCode || 200).json(status);
});

function createDirectEndpoint(name, actionHandler) {
  return onRequest(async (req, res) => {
    applyCors(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (!validateApiKey(req)) {
      res.status(401).json(
          createResponse(
              false,
              null,
              "No autorizado. Envía X-API-Key o Authorization válido.",
              401,
          ),
      );
      return;
    }

    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const query = req.query && typeof req.query === "object" ? req.query : {};
      const payload = body.data !== undefined ? body.data :
        body.payload !== undefined ? body.payload :
        Object.keys(body).length ? body : query;
      const requestInput = {
        data: payload,
        auth: req.auth || null,
        headers: req.headers,
      };
      const result = await actionHandler(requestInput);
      const httpResponse = result && typeof result === "object" && "ok" in result ?
        result :
        createResponse(true, result, `Función '${name}' ejecutada correctamente`);

      res.status(200).json(httpResponse);
    } catch (error) {
      res.status(500).json(
          createResponse(
              false,
              null,
              error.message || `Error ejecutando la acción '${name}'.`,
              500,
          ),
      );
    }
  });
}

const directEndpoints = Object.keys(peps).reduce((accumulator, key) => {
  const actionHandler = peps[key];

  if (typeof actionHandler === "function") {
    accumulator[key] = createDirectEndpoint(key, actionHandler);
  }

  return accumulator;
}, {});

module.exports = {
  ...directEndpoints,
  apiHealth,
  apiGateway,
  apiTestConnection,
};
