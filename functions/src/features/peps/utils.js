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

// Hora local de la operación (México, UTC-6, sin horario de verano desde 2022).
const LOCAL_UTC_OFFSET_MINUTES = -6 * 60;

function toLocalIsoString(date = new Date()) {
  const local = new Date(date.getTime() + LOCAL_UTC_OFFSET_MINUTES * 60000);
  const absOffset = Math.abs(LOCAL_UTC_OFFSET_MINUTES);
  const sign = LOCAL_UTC_OFFSET_MINUTES < 0 ? "-" : "+";
  const hh = String(Math.floor(absOffset / 60)).padStart(2, "0");
  const mm = String(absOffset % 60).padStart(2, "0");
  return `${local.toISOString().slice(0, -1)}${sign}${hh}:${mm}`;
}

function toLocalDateString(date = new Date()) {
  return toLocalIsoString(date).slice(0, 10);
}

function normalizeDate(value, fallbackDate = new Date()) {
  if (!value) {
    return toLocalDateString(new Date(fallbackDate));
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Fecha inválida.");
  }

  return toLocalDateString(date);
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
    "tipoMaterialAsignado",
    "tipoMaterial",
    "tipoItemAsignado",
    "estadoLote",
    "loteEnUso",
    "estadoTemporal",
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
    "rackNumero",
    "rackOrigen",
    "rackOrigenId",
    "rackOrigenNumero",
    "rackOrigenTipo",
    "rackDestino",
    "rackDestinoId",
    "rackDestinoNumero",
    "rackDestinoTipo",
    "ubicacionOrigen",
    "ubicacionDestino",
    "UbicacionDestino",
    "itemId",
    "stockId",
    "tipoMovimiento",
    "direccion",
    "movimientoRelacion",
    "fecha",
    "fechaCaducidad",
    "cantidad",
    "unidad",
    "observacion",
    "observaciones",
    "usuario",
    "nombreItem",
    "tipoItem",
    "lote",
    "numeroAnalisis",
    "color",
    "color2",
    "stockAnterior",
    "stockFinal",
    "detalle",
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
  toLocalIsoString,
  toLocalDateString,
  buildItemId,
  buildRackDocPayload,
  buildMovementRecord,
  getCollectionForType,
  getRackReference,
  safeArray,
  getDefaultResponse,
};
