const {onRequest} = require("firebase-functions/v2/https");

function makeApiHandler(handler) {
  const wrapped = onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type,Authorization,X-API-Key");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      const body = req && req.body && typeof req.body === "object" ? req.body : {};
      const query = req && req.query && typeof req.query === "object" ? req.query : {};
      const payload = body.data !== undefined ? body.data :
        body.payload !== undefined ? body.payload :
        Object.keys(body).length ? body : query;

      const result = await handler({
        data: payload && typeof payload === "object" ? payload : {},
        auth: req && req.auth ? req.auth : null,
        headers: req && req.headers ? req.headers : {},
        query,
      });

      if (result && typeof result === "object" && "ok" in result) {
        res.status(200).json(result);
        return;
      }

      res.status(200).json({
        ok: true,
        data: result ?? null,
        message: "Acción ejecutada correctamente",
        timestamp: new Date().toISOString(),
        statusCode: 200,
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        data: null,
        message: error && error.message ? error.message : "Error ejecutando la acción",
        timestamp: new Date().toISOString(),
        statusCode: 500,
      });
    }
  });

  wrapped.__rawHandler = handler;
  return wrapped;
}

const {
  getDb,
  getCollectionForType,
  sanitizePayload,
  validateRequired,
  normalizeItemType,
  normalizeDate,
  buildItemId,
  getDefaultResponse,
} = require("./utils");

const ITEM_ALLOWED_FIELDS = [
  "id",
  "itemId",
  "nombre",
  "tipo",
  "unidad",
  "tipoUnidad",
  "estado",
  "estatus",
  "activo",
  "descripcion",
  "lote",
  "color",
  "color2",
  "cantidadActual",
  "rackId",
  "fechaEntrada",
  "fechaCreacion",
  "fechaActualizacion",
];

function normalizeStatusValue(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "activo" || normalized === "inactivo") {
    return normalized;
  }

  if (normalized === "true" || normalized === "1") {
    return "activo";
  }

  if (normalized === "false" || normalized === "0") {
    return "inactivo";
  }

  return null;
}

async function sincronizarNombreEnStockPorItem({itemId, nombre, tipoItem = null}) {
  if (!itemId || !nombre) {
    return 0;
  }

  const db = getDb();
  const snapshot = await db.collection("pepsRackStock")
      .where("itemId", "==", itemId)
      .get();

  if (snapshot.empty) {
    return 0;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    const update = {
      nombreItem: nombre,
      fechaActualizacion: new Date().toISOString(),
    };

    if (tipoItem) {
      update.tipoItem = tipoItem;
    }

    batch.update(doc.ref, update);
  });

  await batch.commit();
  return snapshot.docs.length;
}

function buildItemPayload(data) {
  const payload = sanitizePayload(data || {}, ITEM_ALLOWED_FIELDS);

  if (payload.tipo) {
    payload.tipo = normalizeItemType(payload.tipo);
  }

  if (payload.fechaEntrada) {
    payload.fechaEntrada = normalizeDate(payload.fechaEntrada);
  }

  const explicitStatus = normalizeStatusValue(
      payload.estado !== undefined ? payload.estado :
      payload.estatus !== undefined ? payload.estatus :
      payload.activo,
  );

  if (explicitStatus) {
    payload.estado = explicitStatus;
    payload.estatus = explicitStatus;
    payload.activo = explicitStatus === "activo";
  } else if (Object.prototype.hasOwnProperty.call(payload, "activo")) {
    const active = Boolean(payload.activo);
    payload.estado = active ? "activo" : "inactivo";
    payload.estatus = payload.estado;
    payload.activo = active;
  }

  if (!payload.fechaCreacion) {
    payload.fechaCreacion = new Date().toISOString();
  }
  if (!payload.fechaActualizacion) {
    payload.fechaActualizacion = new Date().toISOString();
  }
  return payload;
}

const crearMateriaPrima = makeApiHandler(async (request) => {
  try {
    const payload = buildItemPayload(request.data);
    validateRequired(payload, ["nombre"], "Materia prima");
    payload.tipo = "materia_prima";
    payload.id = payload.id || payload.itemId || buildItemId("mp");
    const db = getDb();
    const ref = db.collection(getCollectionForType(payload.tipo)).doc(payload.id);
    const snapshot = await ref.get();
    if (snapshot.exists) {
      throw new Error("Ya existe una materia prima con ese identificador.");
    }
    const item = {
      ...payload,
      itemId: payload.id,
      fechaCreacion: payload.fechaCreacion || new Date().toISOString(),
      fechaActualizacion: new Date().toISOString(),
    };
    await ref.set(item);
    return getDefaultResponse(true, item, "Materia prima creada correctamente");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error creando materia prima");
  }
});

const obtenerMateriaPrima = makeApiHandler(async (request) => {
  try {
    const itemId = request.data && request.data.id ? request.data.id : null;
    if (!itemId) {
      throw new Error("Debe indicar el id de la materia prima.");
    }
    const db = getDb();
    const doc = await db.collection("pepsMateriaPrima").doc(itemId).get();
    if (!doc.exists) {
      return getDefaultResponse(false, [], "No se encontró la materia prima");
    }
    return getDefaultResponse(true, doc.data(), "Materia prima encontrada");
  } catch (error) {
    return getDefaultResponse(false, [], error.message || "Error obteniendo materia prima");
  }
});

const actualizarMateriaPrima = makeApiHandler(async (request) => {
  try {
    const {id, updates} = request.data || {};
    if (!id) {
      throw new Error("Debe indicar el id de la materia prima.");
    }
    const db = getDb();
    const ref = db.collection("pepsMateriaPrima").doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error("La materia prima no existe.");
    }
    const payload = buildItemPayload(updates || {});
    payload.tipo = "materia_prima";
    payload.fechaActualizacion = new Date().toISOString();
    await ref.update(payload);

    if (typeof payload.nombre === "string" && payload.nombre.trim()) {
      await sincronizarNombreEnStockPorItem({
        itemId: id,
        nombre: payload.nombre.trim(),
        tipoItem: payload.tipo || null,
      });
    }

    const updated = await ref.get();
    return getDefaultResponse(true, updated.data(), "Materia prima actualizada");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error actualizando materia prima");
  }
});

const obtenerItemsPorTipo = makeApiHandler(async (request) => {
  try {
    const tipo = request.data && request.data.tipo ? normalizeItemType(request.data.tipo) : null;
    if (!tipo) {
      throw new Error("Debe indicar el tipo de item.");
    }
    const db = getDb();
    const snapshot = await db.collection(getCollectionForType(tipo)).orderBy("fechaCreacion", "asc").get();
    const items = snapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
    return getDefaultResponse(true, items, `Items del tipo ${tipo} obtenidos correctamente`);
  } catch (error) {
    return getDefaultResponse(false, [], error.message || "Error obteniendo items por tipo");
  }
});

const crearAcondicionamiento = makeApiHandler(async (request) => {
  try {
    const payload = buildItemPayload(request.data);
    validateRequired(payload, ["nombre"], "Material de acondicionamiento");
    payload.tipo = "material_acondicionamiento";
    payload.id = payload.id || payload.itemId || buildItemId("ma");
    const db = getDb();
    const ref = db.collection(getCollectionForType(payload.tipo)).doc(payload.id);
    const snapshot = await ref.get();
    if (snapshot.exists) {
      throw new Error("Ya existe un material de acondicionamiento con ese identificador.");
    }
    const item = {
      ...payload,
      itemId: payload.id,
      fechaCreacion: payload.fechaCreacion || new Date().toISOString(),
      fechaActualizacion: new Date().toISOString(),
    };
    await ref.set(item);
    return getDefaultResponse(true, item, "Material de acondicionamiento creado correctamente");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error creando material de acondicionamiento");
  }
});

const obtenerAcondicionamiento = makeApiHandler(async (request) => {
  try {
    const itemId = request.data && request.data.id ? request.data.id : null;
    if (!itemId) {
      throw new Error("Debe indicar el id del material de acondicionamiento.");
    }
    const doc = await getDb().collection("pepsMaterialAcondicionamiento").doc(itemId).get();
    if (!doc.exists) {
      return getDefaultResponse(false, [], "No se encontró el material de acondicionamiento");
    }
    return getDefaultResponse(true, doc.data(), "Material de acondicionamiento encontrado");
  } catch (error) {
    return getDefaultResponse(false, [], error.message || "Error obteniendo material de acondicionamiento");
  }
});

const actualizarAcondicionamiento = makeApiHandler(async (request) => {
  try {
    const {id, updates} = request.data || {};
    if (!id) {
      throw new Error("Debe indicar el id del material de acondicionamiento.");
    }
    const db = getDb();
    const ref = db.collection("pepsMaterialAcondicionamiento").doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error("El material de acondicionamiento no existe.");
    }
    const payload = buildItemPayload(updates || {});
    payload.tipo = "material_acondicionamiento";
    payload.fechaActualizacion = new Date().toISOString();
    await ref.update(payload);

    if (typeof payload.nombre === "string" && payload.nombre.trim()) {
      await sincronizarNombreEnStockPorItem({
        itemId: id,
        nombre: payload.nombre.trim(),
        tipoItem: payload.tipo || null,
      });
    }

    const updated = await ref.get();
    return getDefaultResponse(true, updated.data(), "Material de acondicionamiento actualizado");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error actualizando material de acondicionamiento");
  }
});

const crearProducto = makeApiHandler(async (request) => {
  try {
    const payload = buildItemPayload(request.data);
    validateRequired(payload, ["nombre"], "Producto");
    payload.tipo = "producto_terminado";
    payload.id = payload.id || payload.itemId || buildItemId("pt");
    const db = getDb();
    const ref = db.collection(getCollectionForType(payload.tipo)).doc(payload.id);
    const snapshot = await ref.get();
    if (snapshot.exists) {
      throw new Error("Ya existe un producto con ese identificador.");
    }
    const item = {
      ...payload,
      itemId: payload.id,
      fechaCreacion: payload.fechaCreacion || new Date().toISOString(),
      fechaActualizacion: new Date().toISOString(),
    };
    await ref.set(item);
    return getDefaultResponse(true, item, "Producto creado correctamente");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error creando producto");
  }
});

const obtenerProducto = makeApiHandler(async (request) => {
  try {
    const itemId = request.data && request.data.id ? request.data.id : null;
    if (!itemId) {
      throw new Error("Debe indicar el id del producto.");
    }
    const doc = await getDb().collection("pepsProductoTerminado").doc(itemId).get();
    if (!doc.exists) {
      return getDefaultResponse(false, [], "No se encontró el producto");
    }
    return getDefaultResponse(true, doc.data(), "Producto encontrado");
  } catch (error) {
    return getDefaultResponse(false, [], error.message || "Error obteniendo producto");
  }
});

const actualizarProducto = makeApiHandler(async (request) => {
  try {
    const {id, updates} = request.data || {};
    if (!id) {
      throw new Error("Debe indicar el id del producto.");
    }
    const db = getDb();
    const ref = db.collection("pepsProductoTerminado").doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error("El producto no existe.");
    }
    const payload = buildItemPayload(updates || {});
    payload.tipo = "producto_terminado";
    payload.fechaActualizacion = new Date().toISOString();
    await ref.update(payload);

    if (typeof payload.nombre === "string" && payload.nombre.trim()) {
      await sincronizarNombreEnStockPorItem({
        itemId: id,
        nombre: payload.nombre.trim(),
        tipoItem: payload.tipo || null,
      });
    }

    const updated = await ref.get();
    return getDefaultResponse(true, updated.data(), "Producto actualizado");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error actualizando producto");
  }
});

module.exports = {
  crearMateriaPrima,
  obtenerMateriaPrima,
  actualizarMateriaPrima,
  obtenerItemsPorTipo,
  crearAcondicionamiento,
  obtenerAcondicionamiento,
  actualizarAcondicionamiento,
  crearProducto,
  obtenerProducto,
  actualizarProducto,
};
