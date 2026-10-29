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
      const payload = body.data !== undefined ? body.data : body.payload !== undefined ? body.payload :
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
  STOCK_COLLECTION,
  validateNumeric,
  validateRequired,
  normalizeDate,
  getRackReference,
  getDefaultResponse,
} = require("./utils");

function getStockCollection() {
  return getDb().collection(STOCK_COLLECTION);
}

async function ensureRackExists(rackId) {
  const dbInstance = getDb();
  const rack = await dbInstance.collection("pepsRacks").doc(rackId).get();
  if (!rack.exists) {
    throw new Error("El rack indicado no existe.");
  }
}

async function getItemDoc(itemId, tipoItem) {
  const db = getDb();
  const collectionMap = {
    materia_prima: "pepsMateriaPrima",
    material_acondicionamiento: "pepsMaterialAcondicionamiento",
    producto_terminado: "pepsProductoTerminado",
  };
  const collection = collectionMap[tipoItem] || "pepsMateriaPrima";
  const snapshot = await db.collection(collection).doc(itemId).get();
  if (!snapshot.exists) {
    throw new Error("El item indicado no existe.");
  }
  return snapshot.data();
}

const crearStock = makeApiHandler(async (request) => {
  try {
    const payload = request.data || {};
    validateRequired(payload, ["rackId", "itemId", "nombreItem", "tipoItem", "cantidadActual"], "Stock");
    const rackId = getRackReference(payload.rackId);
    if (!rackId) {
      throw new Error("rackId es obligatorio.");
    }
    await ensureRackExists(rackId);
    const cantidad = validateNumeric(payload.cantidadActual, "cantidadActual", {min: 0});
    const collection = getStockCollection();
    const ref = collection.doc(`${rackId}_${payload.itemId}`);
    const stock = {
      id: ref.id,
      rackId: rackId,
      itemId: payload.itemId,
      nombreItem: payload.nombreItem,
      tipoItem: payload.tipoItem,
      cantidadActual: cantidad,
      unidad: payload.unidad || "",
      lote: payload.lote || "",
      color: payload.color || "",
      color2: payload.color2 || "",
      fechaEntrada: normalizeDate(payload.fechaEntrada || new Date(), new Date()),
      fechaCreacion: new Date().toISOString(),
      fechaActualizacion: new Date().toISOString(),
    };
    await ref.set(stock);
    return getDefaultResponse(true, stock, "Stock creado correctamente");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error creando stock");
  }
});

const actualizarCantidadStock = makeApiHandler(async (request) => {
  try {
    const payload = request.data || {};
    validateRequired(payload, ["rackId", "itemId", "cantidadActual"], "Stock");
    const rackId = getRackReference(payload.rackId);
    const ref = getStockCollection().doc(`${rackId}_${payload.itemId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error("No existe stock para este rack e item.");
    }
    const cantidad = validateNumeric(payload.cantidadActual, "cantidadActual", {min: 0});
    const current = snapshot.data();
    await ref.update({
      cantidadActual: cantidad,
      fechaActualizacion: new Date().toISOString(),
      nombreItem: payload.nombreItem || current.nombreItem,
      tipoItem: payload.tipoItem || current.tipoItem,
    });
    const updated = await ref.get();
    return getDefaultResponse(true, updated.data(), "Stock actualizado");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error actualizando stock");
  }
});

const eliminarStock = makeApiHandler(async (request) => {
  try {
    const payload = request.data || {};
    validateRequired(payload, ["rackId", "itemId"], "Stock");
    const rackId = getRackReference(payload.rackId);
    const ref = getStockCollection().doc(`${rackId}_${payload.itemId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error("No existe stock para este rack e item.");
    }
    await ref.delete();
    return getDefaultResponse(true, {rackId, itemId: payload.itemId}, "Stock eliminado");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error eliminando stock");
  }
});

const actualizarColorStockPorItem = makeApiHandler(async (request) => {
  try {
    const payload = request && request.data ? request.data : {};
    const itemId = payload.itemId ? String(payload.itemId).trim() : "";

    if (!itemId) {
      return getDefaultResponse(true, {updated: 0}, "No se indicó itemId para actualizar color");
    }

    const snapshot = await getStockCollection()
        .where("itemId", "==", itemId)
        .get();

    if (snapshot.empty) {
      return getDefaultResponse(true, {updated: 0}, "No se encontró stock para este item");
    }

    const db = getDb();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      const current = doc.data() || {};
      batch.update(doc.ref, {
        color: payload.color !== undefined ? payload.color : current.color || "",
        color2: payload.color2 !== undefined ? payload.color2 : current.color2 || "",
        fechaActualizacion: new Date().toISOString(),
      });
    });

    await batch.commit();
    return getDefaultResponse(true, {updated: snapshot.docs.length}, "Color de stock actualizado");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error actualizando color del stock");
  }
});

const obtenerStockPEPS = makeApiHandler(async (request) => {
  try {
    const payload = request && request.data ? request.data : {};
    const rackId = payload.rackId ? getRackReference(payload.rackId) : null;
    const itemId = payload.itemId ? String(payload.itemId).trim() : null;

    let query = getStockCollection();
    if (rackId) {
      query = query.where("rackId", "==", rackId);
    }
    if (itemId) {
      query = query.where("itemId", "==", itemId);
    }

    const snapshot = await query.get();
    const stock = snapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
    return getDefaultResponse(true, stock, "Stock PEPS obtenido");
  } catch (error) {
    return getDefaultResponse(false, [], error.message || "Error obteniendo stock PEPS");
  }
});

const obtenerStockPorRack = makeApiHandler(async (request) => {
  try {
    const rackId = getRackReference(request.data && request.data.rackId ? request.data.rackId : null);
    if (!rackId) {
      throw new Error("Debe indicar el rackId.");
    }
    const snapshot = await getStockCollection().where("rackId", "==", rackId).get();
    const stock = snapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
    return getDefaultResponse(true, stock, "Stock por rack obtenido");
  } catch (error) {
    return getDefaultResponse(false, [], error.message || "Error obteniendo stock por rack");
  }
});

const descontarStockPEPS = makeApiHandler(async (request) => {
  try {
    const payload = request.data || {};
    validateRequired(payload, ["rackId", "itemId", "cantidadSalida"], "Salida de stock");
    const rackId = getRackReference(payload.rackId);
    const itemId = payload.itemId;
    const cantidadSalida = validateNumeric(payload.cantidadSalida, "cantidadSalida", {min: 0.0001});
    const ref = getStockCollection().doc(`${rackId}_${itemId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error("No existe stock para el item solicitado en el rack indicado.");
    }
    const current = snapshot.data();
    if (current.cantidadActual < cantidadSalida) {
      throw new Error("No hay stock suficiente para la salida solicitada.");
    }
    const nuevoTotal = Number(current.cantidadActual) - cantidadSalida;
    await ref.update({
      cantidadActual: nuevoTotal,
      fechaActualizacion: new Date().toISOString(),
    });
    return getDefaultResponse(true, {
      rackId,
      itemId,
      cantidadSalida,
      stockFinal: nuevoTotal,
    }, "Stock descontado correctamente");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error descontando stock");
  }
});

const trasladarStockPEPS = makeApiHandler(async (request) => {
  try {
    const payload = request.data || {};
    validateRequired(payload, ["rackOrigen", "rackDestino", "itemId", "cantidad"], "Traslado de stock");
    const rackOrigen = getRackReference(payload.rackOrigen);
    const rackDestino = getRackReference(payload.rackDestino);
    if (!rackOrigen || !rackDestino) {
      throw new Error("Debe indicar rackOrigen y rackDestino válidos.");
    }
    const cantidad = validateNumeric(payload.cantidad, "cantidad", {min: 0.0001});
    const sourceRef = getStockCollection().doc(`${rackOrigen}_${payload.itemId}`);
    const sourceSnapshot = await sourceRef.get();
    if (!sourceSnapshot.exists || Number(sourceSnapshot.data().cantidadActual) < cantidad) {
      throw new Error("No hay suficiente stock en el rack origen para el traslado.");
    }
    const destinoRef = getStockCollection().doc(`${rackDestino}_${payload.itemId}`);
    const destinoSnapshot = await destinoRef.get();
    const currentDestino = destinoSnapshot.exists ? destinoSnapshot.data().cantidadActual : 0;
    const newSourceQuantity = Number(sourceSnapshot.data().cantidadActual) - cantidad;
    const newDestinationQuantity = Number(currentDestino) + cantidad;
    await sourceRef.update({
      cantidadActual: newSourceQuantity,
      fechaActualizacion: new Date().toISOString(),
    });
    if (destinoSnapshot.exists) {
      await destinoRef.update({
        cantidadActual: newDestinationQuantity,
        fechaActualizacion: new Date().toISOString(),
      });
    } else {
      const item = await getItemDoc(
          payload.itemId,
          payload.tipoItem || sourceSnapshot.data().tipoItem || "materia_prima",
      );
      await destinoRef.set({
        id: destinoRef.id,
        rackId: rackDestino,
        itemId: payload.itemId,
        nombreItem: item.nombre || sourceSnapshot.data().nombreItem,
        tipoItem: item.tipo || sourceSnapshot.data().tipoItem,
        cantidadActual: newDestinationQuantity,
        unidad: item.unidad || sourceSnapshot.data().unidad || "",
        lote: item.lote || sourceSnapshot.data().lote || "",
        color: item.color || sourceSnapshot.data().color || "",
        color2: item.color2 || sourceSnapshot.data().color2 || "",
        fechaEntrada: normalizeDate(sourceSnapshot.data().fechaEntrada || new Date(), new Date()),
        fechaCreacion: sourceSnapshot.data().fechaCreacion || new Date().toISOString(),
        fechaActualizacion: new Date().toISOString(),
      });
    }
    return getDefaultResponse(true, {
      rackOrigen,
      rackDestino,
      itemId: payload.itemId,
      cantidad,
      stockOrigenFinal: newSourceQuantity,
      stockDestinoFinal: newDestinationQuantity,
    }, "Traslado realizado correctamente");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error trasladando stock");
  }
});

const suscribirStock = makeApiHandler(async () => {
  return getDefaultResponse(true, [], "Suscripción de stock disponible en Firestore real-time");
});

const suscribirStockPorRack = makeApiHandler(async (request) => {
  try {
    const payload = request && request.data ? request.data : {};
    const rackId = payload.rackId ? getRackReference(payload.rackId) : null;
    const snapshot = rackId ? await getStockCollection().where("rackId", "==", rackId).get() :
    await getStockCollection().get();

    const stock = snapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
    return getDefaultResponse(true, stock, "Suscripción de stock por rack disponible en Firestore real-time");
  } catch (error) {
    return getDefaultResponse(false, [], error.message || "Error consultando stock por rack");
  }
});

const refreshRackStockCaches = makeApiHandler(async () => {
  return getDefaultResponse(true, {refreshedAt: new Date().toISOString()}, "Cachés de rack stock actualizadas");
});

module.exports = {
  crearStock,
  actualizarCantidadStock,
  eliminarStock,
  actualizarColorStockPorItem,
  obtenerStockPEPS,
  descontarStockPEPS,
  trasladarStockPEPS,
  obtenerStockPorRack,
  suscribirStock,
  suscribirStockPorRack,
  refreshRackStockCaches,
};
