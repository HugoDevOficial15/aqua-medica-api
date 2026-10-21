const {onCall} = require("firebase-functions/v2/https");
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
  "nombre",
  "tipo",
  "unidad",
  "lote",
  "color",
  "color2",
  "cantidadActual",
  "rackId",
  "itemId",
  "fechaEntrada",
  "fechaCreacion",
  "fechaActualizacion",
];

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
  if (!payload.fechaCreacion) {
    payload.fechaCreacion = new Date().toISOString();
  }
  if (!payload.fechaActualizacion) {
    payload.fechaActualizacion = new Date().toISOString();
  }
  return payload;
}

const crearMateriaPrima = onCall(async (request) => {
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

const obtenerMateriaPrima = onCall(async (request) => {
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

const actualizarMateriaPrima = onCall(async (request) => {
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

const obtenerItemsPorTipo = onCall(async (request) => {
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

const crearAcondicionamiento = onCall(async (request) => {
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

const obtenerAcondicionamiento = onCall(async (request) => {
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

const actualizarAcondicionamiento = onCall(async (request) => {
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

const crearProducto = onCall(async (request) => {
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

const obtenerProducto = onCall(async (request) => {
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

const actualizarProducto = onCall(async (request) => {
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
