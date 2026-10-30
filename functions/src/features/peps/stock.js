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

function getRackCapacityMap(rack = {}) {
  return {
    materia_prima: Number(rack.pesoMaximoMateriaPrima ?? rack["pesoMaximo-materiaPrima"] ?? 0),
    material_acondicionamiento: Number(rack.pesoMaximoMaterialAcondicionamiento ?? rack["pesoMaximo-materialAcondicionamiento"] ?? 0),
    producto_terminado: Number(rack.pesoMaximoProductoTerminado ?? rack["pesoMaximo-productoTerminado"] ?? 0),
  };
}

function calculateRackOccupancy(rack = {}, stockItems = []) {
  const capacityByType = getRackCapacityMap(rack);
  const stockByType = Object.keys(capacityByType).reduce((acc, type) => {
    acc[type] = (stockItems || [])
      .filter((item) => String(item && item.tipoItem || "") === type)
      .reduce((total, item) => total + Number(item && item.cantidadActual || 0), 0);
    return acc;
  }, {});

  const ocupacionPorTipo = Object.entries(capacityByType).reduce((acc, [type, capacity]) => {
    acc[type] = Number(capacity > 0 ? ((stockByType[type] / capacity) * 100).toFixed(2) : 0);
    return acc;
  }, {});

  const espacioOcupado = Number(
    Math.min(
      100,
      Object.values(ocupacionPorTipo).reduce((sum, value) => sum + Number(value || 0), 0),
    ).toFixed(2),
  );

  return {
    ocupacionPorTipo,
    espacioOcupado,
    stockByType,
  };
}

async function syncRackOccupancy(rackId, rackOverride = null, stockItemsOverride = null) {
  const db = getDb();
  const rackRef = db.collection("pepsRacks").doc(rackId);
  const rackSnapshot = rackOverride ? {exists: true, data: () => rackOverride} : await rackRef.get();
  if (!rackSnapshot || !rackSnapshot.exists) {
    return null;
  }

  const rackData = rackSnapshot.data() || {};
  const stockItems = stockItemsOverride ?? (await getStockCollection().where("rackId", "==", rackId).get()).docs.map((doc) => ({id: doc.id, ...doc.data()}));
  const occupancy = calculateRackOccupancy(rackData, stockItems);

  await rackRef.update({
    espacioOcupado: occupancy.espacioOcupado,
    ocupacionPorTipo: occupancy.ocupacionPorTipo,
    fechaActualizacion: new Date().toISOString(),
  });

  return {
    espacioOcupado: occupancy.espacioOcupado,
    ocupacionPorTipo: occupancy.ocupacionPorTipo,
  };
}

async function getStockLinesByRackAndItem(rackId, itemId) {
  const snapshot = await getStockCollection()
    .where("rackId", "==", rackId)
    .where("itemId", "==", String(itemId).trim())
    .get();

  return snapshot.docs
    .map((doc) => ({id: doc.id, ...doc.data()}))
    .filter((row) => Number(row && row.cantidadActual || 0) > 0)
    .sort((a, b) => {
      const orderA = String(a.fechaEntrada || "");
      const orderB = String(b.fechaEntrada || "");
      return orderA.localeCompare(orderB);
    });
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
    const cantidad = validateNumeric(payload.cantidadActual, "cantidadActual", {min: 0.0001});
    const collection = getStockCollection();
    const itemId = String(payload.itemId).trim();
    const tipoItem = String(payload.tipoItem).trim();
    const lote = String(payload.lote || "").trim();
    const numeroAnalisis = String(payload.numeroAnalisis || "").trim();

    let stock;
    const exactMatch = await collection
      .where("rackId", "==", rackId)
      .where("itemId", "==", itemId)
      .where("tipoItem", "==", tipoItem)
      .where("lote", "==", lote)
      .where("numeroAnalisis", "==", numeroAnalisis)
      .limit(1)
      .get();

    if (!exactMatch.empty) {
      const existingDoc = exactMatch.docs[0];
      const existing = existingDoc.data() || {};
      const updatedCantidad = Number(existing.cantidadActual || 0) + cantidad;
      await existingDoc.ref.update({
        cantidadActual: updatedCantidad,
        unidad: payload.unidad || existing.unidad || "",
        nombreItem: payload.nombreItem || existing.nombreItem,
        fechaActualizacion: new Date().toISOString(),
      });
      stock = {id: existingDoc.id, ...existing, cantidadActual: updatedCantidad, unidad: payload.unidad || existing.unidad || "", nombreItem: payload.nombreItem || existing.nombreItem};
    } else {
      const ref = collection.doc();
      stock = {
        id: ref.id,
        rackId,
        itemId,
        nombreItem: payload.nombreItem,
        tipoItem,
        cantidadActual: cantidad,
        unidad: payload.unidad || "",
        lote,
        numeroAnalisis,
        color: payload.color || "",
        color2: payload.color2 || "",
        fechaEntrada: normalizeDate(payload.fechaEntrada || new Date(), new Date()),
        fechaCreacion: new Date().toISOString(),
        fechaActualizacion: new Date().toISOString(),
      };
      await ref.set(stock);
    }

    const rackSnapshot = await getDb().collection("pepsRacks").doc(rackId).get();
    if (rackSnapshot.exists) {
      const rack = {id: rackSnapshot.id, ...rackSnapshot.data()};
      const rackStockSnapshot = await collection.where("rackId", "==", rackId).get();
      const rackStock = rackStockSnapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
      await syncRackOccupancy(rackId, rack, rackStock);
    }

    return getDefaultResponse(true, stock, "Stock creado correctamente");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error creando stock");
  }
});

const actualizarCantidadStock = makeApiHandler(async (request) => {
  try {
    const payload = request.data || {};
    const rackId = getRackReference(payload.rackId);
    const stockId = payload.stockId ? String(payload.stockId).trim() : "";

    if (!stockId && !(rackId && payload.itemId)) {
      throw new Error("Debe indicar stockId o rackId + itemId.");
    }

    let ref;
    if (stockId) {
      ref = getStockCollection().doc(stockId);
    } else {
      const matches = await getStockCollection()
        .where("rackId", "==", rackId)
        .where("itemId", "==", String(payload.itemId).trim())
        .orderBy("fechaEntrada", "asc")
        .limit(1)
        .get();
      if (matches.empty) {
        throw new Error("No existe stock para este rack e item.");
      }
      ref = matches.docs[0].ref;
    }

    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error("No existe stock para este rack e item.");
    }

    const cantidad = validateNumeric(payload.cantidadActual, "cantidadActual", {min: 0});
    const current = snapshot.data() || {};
    await ref.update({
      cantidadActual: cantidad,
      fechaActualizacion: new Date().toISOString(),
      nombreItem: payload.nombreItem || current.nombreItem,
      tipoItem: payload.tipoItem || current.tipoItem,
      lote: payload.lote !== undefined ? payload.lote : current.lote,
      numeroAnalisis: payload.numeroAnalisis !== undefined ? payload.numeroAnalisis : current.numeroAnalisis,
    });

    const rackSnapshot = await getDb().collection("pepsRacks").doc(rackId || current.rackId).get();
    if (rackSnapshot.exists) {
      const rack = {id: rackSnapshot.id, ...rackSnapshot.data()};
      const rackStockSnapshot = await getStockCollection().where("rackId", "==", rackId || current.rackId).get();
      const rackStock = rackStockSnapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
      await syncRackOccupancy(rackId || current.rackId, rack, rackStock);
    }

    const updated = await ref.get();
    return getDefaultResponse(true, updated.data(), "Stock actualizado");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error actualizando stock");
  }
});

const eliminarStock = makeApiHandler(async (request) => {
  try {
    const payload = request.data || {};
    const stockId = payload.stockId ? String(payload.stockId).trim() : "";
    const rackId = getRackReference(payload.rackId);

    if (!stockId && !(rackId && payload.itemId)) {
      throw new Error("Debe indicar stockId o rackId + itemId.");
    }

    if (stockId) {
      const snapshot = await getStockCollection().doc(stockId).get();
      if (!snapshot.exists) {
        throw new Error("No existe stock para este id.");
      }
      const selected = snapshot.data() || {};
      await snapshot.ref.delete();
      const rackSnapshot = await getDb().collection("pepsRacks").doc(selected.rackId).get();
      if (rackSnapshot.exists) {
        const rack = {id: rackSnapshot.id, ...rackSnapshot.data()};
        const rackStockSnapshot = await getStockCollection().where("rackId", "==", selected.rackId).get();
        const rackStock = rackStockSnapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
        await syncRackOccupancy(selected.rackId, rack, rackStock);
      }
      return getDefaultResponse(true, {rackId: selected.rackId, itemId: selected.itemId}, "Stock eliminado");
    }

    const matches = await getStockCollection()
      .where("rackId", "==", rackId)
      .where("itemId", "==", String(payload.itemId).trim())
      .get();

    if (matches.empty) {
      throw new Error("No existe stock para este rack e item.");
    }

    const batch = getDb().batch();
    matches.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    const rackSnapshot = await getDb().collection("pepsRacks").doc(rackId).get();
    if (rackSnapshot.exists) {
      const rack = {id: rackSnapshot.id, ...rackSnapshot.data()};
      const rackStockSnapshot = await getStockCollection().where("rackId", "==", rackId).get();
      const rackStock = rackStockSnapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
      await syncRackOccupancy(rackId, rack, rackStock);
    }

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
    const stock = snapshot.docs
      .map((doc) => ({id: doc.id, ...doc.data()}))
      .sort((a, b) => String(a.fechaEntrada || "").localeCompare(String(b.fechaEntrada || "")));
    return getDefaultResponse(true, stock, "Stock PEPS obtenido");
  } catch (error) {
    return getDefaultResponse(false, [], error.message || "Error obteniendo stock PEPS");
  }
});

const obtenerStockPorRack = makeApiHandler(async (request) => {
  try {
    const payload = request && request.data ? request.data : {};
    const rackId = getRackReference(payload.rackId || null);
    if (!rackId) {
      throw new Error("Debe indicar el rackId.");
    }
    const snapshot = await getStockCollection()
      .where("rackId", "==", rackId)
      .get();
    const stock = snapshot.docs
      .map((doc) => ({id: doc.id, ...doc.data()}))
      .filter((item) => Number(item.cantidadActual || 0) > 0)
      .sort((a, b) => String(a.fechaEntrada || "").localeCompare(String(b.fechaEntrada || "")));
    return getDefaultResponse(true, stock, "Stock por rack obtenido");
  } catch (error) {
    return getDefaultResponse(false, [], error.message || "Error obteniendo stock por rack");
  }
});

const obtenerOcupacionRack = makeApiHandler(async (request) => {
  try {
    const payload = request && request.data ? request.data : {};
    const rackId = getRackReference(payload.rackId || null);
    if (!rackId) {
      throw new Error("Debe indicar el rackId.");
    }

    const rackSnapshot = await getDb().collection("pepsRacks").doc(rackId).get();
    if (!rackSnapshot.exists) {
      throw new Error("El rack indicado no existe.");
    }

    const rack = {id: rackSnapshot.id, ...rackSnapshot.data()};
    const stockSnapshot = await getStockCollection().where("rackId", "==", rackId).get();
    const stockItems = stockSnapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
    const occupancy = calculateRackOccupancy(rack, stockItems);

    return getDefaultResponse(true, {
      rackId,
      capacidad: getRackCapacityMap(rack),
      stockActual: {
        materia_prima: stockItems.filter((item) => item.tipoItem === "materia_prima").reduce((sum, item) => sum + Number(item.cantidadActual || 0), 0),
        material_acondicionamiento: stockItems.filter((item) => item.tipoItem === "material_acondicionamiento").reduce((sum, item) => sum + Number(item.cantidadActual || 0), 0),
        producto_terminado: stockItems.filter((item) => item.tipoItem === "producto_terminado").reduce((sum, item) => sum + Number(item.cantidadActual || 0), 0),
      },
      ocupacionPorTipo: occupancy.ocupacionPorTipo,
      espacioOcupado: occupancy.espacioOcupado,
    }, "Ocupación del rack calculada");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error calculando ocupación del rack");
  }
});

const descontarStockPEPS = makeApiHandler(async (request) => {
  try {
    const payload = request.data || {};
    validateRequired(payload, ["rackId", "itemId", "cantidadSalida"], "Salida de stock");
    const rackId = getRackReference(payload.rackId);
    const itemId = String(payload.itemId).trim();
    const cantidadSalida = validateNumeric(payload.cantidadSalida, "cantidadSalida", {min: 0.0001});

    const stockLines = await getStockLinesByRackAndItem(rackId, itemId);
    if (!stockLines.length) {
      throw new Error("No existe stock para el item solicitado en el rack indicado.");
    }

    let remaining = cantidadSalida;
    const detalle = [];
    const db = getDb();

    for (const line of stockLines) {
      if (remaining <= 0) {
        break;
      }

      const current = Number(line.cantidadActual || 0);
      if (current <= 0) {
        continue;
      }

      const cantidadDescontada = Math.min(current, remaining);
      remaining -= cantidadDescontada;
      const nextQuantity = current - cantidadDescontada;
      const stockRef = db.collection(STOCK_COLLECTION).doc(line.id);

      if (nextQuantity > 0) {
        await stockRef.update({
          cantidadActual: nextQuantity,
          fechaActualizacion: new Date().toISOString(),
        });
      } else {
        await stockRef.delete();
      }

      detalle.push({
        stockId: line.id,
        lote: line.lote || "",
        cantidadDescontada,
      });
    }

    if (remaining > 0) {
      throw new Error("No hay stock suficiente para la salida solicitada.");
    }

    const rackSnapshot = await db.collection("pepsRacks").doc(rackId).get();
    if (rackSnapshot.exists) {
      const rack = {id: rackSnapshot.id, ...rackSnapshot.data()};
      const rackStockSnapshot = await getStockCollection().where("rackId", "==", rackId).get();
      const rackStock = rackStockSnapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
      await syncRackOccupancy(rackId, rack, rackStock);
    }

    const remainingTotal = (await getStockLinesByRackAndItem(rackId, itemId))
      .reduce((sum, item) => sum + Number(item.cantidadActual || 0), 0);

    return getDefaultResponse(true, {
      rackId,
      itemId,
      cantidadSalida,
      detalle,
      stockFinal: remainingTotal,
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

    const sourceLines = await getStockLinesByRackAndItem(rackOrigen, payload.itemId);
    if (!sourceLines.length) {
      throw new Error("No hay stock suficiente en el rack origen para el traslado.");
    }

    const totalOrigen = sourceLines.reduce((sum, line) => sum + Number(line.cantidadActual || 0), 0);
    if (totalOrigen < cantidad) {
      throw new Error("No hay suficiente stock en el rack origen para el traslado.");
    }

    const destinoMatches = await getStockCollection()
      .where("rackId", "==", rackDestino)
      .where("itemId", "==", String(payload.itemId).trim())
      .get();

    const destinoMap = new Map();
    destinoMatches.docs.forEach((doc) => {
      const data = doc.data() || {};
      const key = `${String(data.lote || "").trim()}|${String(data.numeroAnalisis || "").trim()}`;
      destinoMap.set(key, doc.ref);
    });

    let remaining = cantidad;
    const db = getDb();

    for (const line of sourceLines) {
      if (remaining <= 0) {
        break;
      }
      const currentCantidad = Number(line.cantidadActual || 0);
      if (currentCantidad <= 0) {
        continue;
      }

      const cantidadTransferida = Math.min(currentCantidad, remaining);
      remaining -= cantidadTransferida;
      const sourceRef = db.collection(STOCK_COLLECTION).doc(line.id);
      const nuevoOrigen = currentCantidad - cantidadTransferida;

      if (nuevoOrigen > 0) {
        await sourceRef.update({cantidadActual: nuevoOrigen, fechaActualizacion: new Date().toISOString()});
      } else {
        await sourceRef.delete();
      }

      const destinoKey = `${String(line.lote || "").trim()}|${String(line.numeroAnalisis || "").trim()}`;
      const destinoRef = destinoMap.get(destinoKey);

      if (destinoRef) {
        const currentDestino = (await destinoRef.get()).data() || {};
        const nextCantidad = Number(currentDestino.cantidadActual || 0) + cantidadTransferida;
        await destinoRef.update({
          cantidadActual: nextCantidad,
          fechaActualizacion: new Date().toISOString(),
        });
      } else {
        const destinoRefNew = db.collection(STOCK_COLLECTION).doc();
        await destinoRefNew.set({
          id: destinoRefNew.id,
          rackId: rackDestino,
          itemId: String(payload.itemId).trim(),
          nombreItem: line.nombreItem,
          tipoItem: line.tipoItem,
          cantidadActual: cantidadTransferida,
          unidad: line.unidad || "",
          lote: line.lote || "",
          numeroAnalisis: line.numeroAnalisis || "",
          color: line.color || "",
          color2: line.color2 || "",
          fechaEntrada: line.fechaEntrada || normalizeDate(new Date(), new Date()),
          fechaCreacion: line.fechaCreacion || new Date().toISOString(),
          fechaActualizacion: new Date().toISOString(),
        });
      }
    }

    if (remaining > 0) {
      throw new Error("No hay suficiente stock en el rack origen para el traslado.");
    }

    const rackOrigenSnapshot = await db.collection("pepsRacks").doc(rackOrigen).get();
    const rackDestinoSnapshot = await db.collection("pepsRacks").doc(rackDestino).get();

    if (rackOrigenSnapshot.exists) {
      const rack = {id: rackOrigenSnapshot.id, ...rackOrigenSnapshot.data()};
      const rackStockSnapshot = await getStockCollection().where("rackId", "==", rackOrigen).get();
      const rackStock = rackStockSnapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
      await syncRackOccupancy(rackOrigen, rack, rackStock);
    }

    if (rackDestinoSnapshot.exists) {
      const rack = {id: rackDestinoSnapshot.id, ...rackDestinoSnapshot.data()};
      const rackStockSnapshot = await getStockCollection().where("rackId", "==", rackDestino).get();
      const rackStock = rackStockSnapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
      await syncRackOccupancy(rackDestino, rack, rackStock);
    }

    const stockOrigenFinal = (await getStockLinesByRackAndItem(rackOrigen, payload.itemId))
      .reduce((sum, item) => sum + Number(item.cantidadActual || 0), 0);
    const stockDestinoFinal = (await getStockLinesByRackAndItem(rackDestino, payload.itemId))
      .reduce((sum, item) => sum + Number(item.cantidadActual || 0), 0);

    return getDefaultResponse(true, {
      rackOrigen,
      rackDestino,
      itemId: payload.itemId,
      cantidad,
      stockOrigenFinal,
      stockDestinoFinal,
    }, "Traslado realizado correctamente");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error trasladando stock");
  }
});

const suscribirStock = makeApiHandler(async (request) => {
  try {
    const payload = request && request.data ? request.data : {};
    const rackId = payload.rackId ? getRackReference(payload.rackId) : null;
    let query = getStockCollection();
    if (rackId) {
      query = query.where("rackId", "==", rackId);
    }
    const snapshot = await query.get();
    const stock = snapshot.docs
      .map((doc) => ({id: doc.id, ...doc.data()}))
      .filter((item) => Number(item.cantidadActual || 0) > 0)
      .sort((a, b) => String(a.fechaEntrada || "").localeCompare(String(b.fechaEntrada || "")));
    return getDefaultResponse(true, stock, rackId ?
      "Stock del rack obtenido en tiempo real" :
      "Stock disponible en Firestore real-time");
  } catch (error) {
    return getDefaultResponse(false, [], error.message || "Error consultando stock");
  }
});

const suscribirStockPorRack = makeApiHandler(async (request) => {
  try {
    const payload = request && request.data ? request.data : {};
    const rackId = payload.rackId ? getRackReference(payload.rackId) : null;
    const snapshot = rackId ? await getStockCollection().where("rackId", "==", rackId).get() :
      await getStockCollection().get();

    const stock = snapshot.docs
      .map((doc) => ({id: doc.id, ...doc.data()}))
      .filter((item) => Number(item.cantidadActual || 0) > 0)
      .sort((a, b) => String(a.fechaEntrada || "").localeCompare(String(b.fechaEntrada || "")));
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
  obtenerOcupacionRack,
  descontarStockPEPS,
  trasladarStockPEPS,
  obtenerStockPorRack,
  suscribirStock,
  suscribirStockPorRack,
  refreshRackStockCaches,
};
