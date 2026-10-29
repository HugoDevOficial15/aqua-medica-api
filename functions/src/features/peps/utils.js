const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const DB = admin.firestore();
const ITEM_TYPES = [
  "materia_prima",
  "material_acondicionamiento",
  "producto_terminado",
];

const ITEM_COLLECTIONS = {
  materia_prima: "pepsMateriaPrima",
  material_acondicionamiento: "pepsMaterialAcondicionamiento",
  producto_terminado: "pepsProductoTerminado",
};

const RACK_COLLECTION = "pepsRacks";
const STOCK_COLLECTION = "pepsRackStock";
const MOVEMENTS_COLLECTION = "pepsMovimientos";

function getDb() {
  return DB;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value).trim();
}

function sanitizePayload(data, allowedFields) {
  const payload = isPlainObject(data) ? data : {};
  const result = {};

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      const value = payload[field];
      if (value !== undefined && value !== null) {
        result[field] = value;
      }
    }
  }

  return result;
}

function validateRequired(payload, fields, label) {
  for (const field of fields) {
    if (payload[field] === undefined || payload[field] === null || String(payload[field]).trim() === "") {
      throw new Error(`${label} requiere el campo '${field}'.`);
    }
  }
}

function validateNumeric(value, fieldName, options = {}) {
  const {min = 0, allowZero = true} = options;
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    throw new Error(`${fieldName} debe ser un número válido.`);
  }

  if (numericValue < min || (!allowZero && numericValue === 0)) {
    throw new Error(`${fieldName} debe ser mayor o igual a ${min}.`);
  }

  return numericValue;
}

function normalizeItemType(tipo) {
  const candidate = normalizeString(tipo).toLowerCase();
  if (!ITEM_TYPES.includes(candidate)) {
    throw new Error(`Tipo inválido: '${tipo}'. Debe ser uno de: ${ITEM_TYPES.join(", ")}.`);
  }
  return candidate;
}

function normalizeDate(value, fallbackDate = new Date()) {
  if (!value) {
    return new Date(fallbackDate).toISOString().slice(0, 10);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Fecha inválida.");
  }

  return date.toISOString().slice(0, 10);
}

function buildItemId(prefix = "item") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildRackDocPayload(payload) {
  return sanitizePayload(payload, [
    "numeroRack",
    "planta",
    "tipoAlmacenamiento",
    "tipoAsignacion",
    "ubicacionTipo",
    "itemAsignado",
    "itemAsignadoId",
    "pesoMaximoMateriaPrima",
    "pesoMaximoMaterialAcondicionamiento",
    "pesoMaximoProductoTerminado",
    "estatus",
    "espacioOcupado",
    "capacidadTotal",
    "ocupacionActual",
    "fechaCreacion",
    "fechaActualizacion",
  ]);
}

function buildMovementRecord(payload) {
  return sanitizePayload(payload, [
    "rackId",
    "itemId",
    "tipoMovimiento",
    "fecha",
    "cantidad",
    "observacion",
    "usuario",
    "nombreItem",
    "tipoItem",
    "stockAnterior",
    "stockFinal",
    "createdAt",
  ]);
}

function getCollectionForType(tipo) {
  const normalized = normalizeItemType(tipo);
  return ITEM_COLLECTIONS[normalized];
}

function getRackReference(rackId) {
  return typeof rackId === "string" ? rackId : rackId && rackId.id ? rackId.id : null;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getDefaultResponse(ok, data, message) {
  return {ok, data, message};
}

module.exports = {
  DB,
  ITEM_TYPES,
  ITEM_COLLECTIONS,
  RACK_COLLECTION,
  STOCK_COLLECTION,
  MOVEMENTS_COLLECTION,
  getDb,
  isPlainObject,
  normalizeString,
  sanitizePayload,
  validateRequired,
  validateNumeric,
  normalizeItemType,
  normalizeDate,
  buildItemId,
  buildRackDocPayload,
  buildMovementRecord,
  getCollectionForType,
  getRackReference,
  safeArray,
  getDefaultResponse,
};
