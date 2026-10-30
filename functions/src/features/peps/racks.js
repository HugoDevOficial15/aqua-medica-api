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
  RACK_COLLECTION,
  MOVEMENTS_COLLECTION,
  buildRackDocPayload,
  buildMovementRecord,
  getRackReference,
  normalizeDate,
  validateRequired,
  validateNumeric,
  getDefaultResponse,
} = require("./utils");

const RACK_LOCK_COLLECTION = "locks";
const RACK_LOCK_TIME_MS = 5 * 60 * 1000;

function parseRackLockExpiration(lockData) {
  if (!lockData || !lockData.expiresAt) {
    return Number.NEGATIVE_INFINITY;
  }

  if (typeof lockData.expiresAt.toDate === "function") {
    return lockData.expiresAt.toDate().getTime();
  }

  const timestamp = new Date(lockData.expiresAt).getTime();
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

const crearRack = makeApiHandler(async (request) => {
  try {
    const payload = buildRackDocPayload(request.data || {});
    validateRequired(
        payload,
        ["numeroRack", "planta", "tipoAlmacenamiento", "tipoAsignacion", "ubicacionTipo"],
        "Rack",
    );
    validateNumeric(payload.pesoMaximoMateriaPrima || 0, "pesoMaximoMateriaPrima", {min: 0});
    validateNumeric(
        payload.pesoMaximoMaterialAcondicionamiento || 0,
        "pesoMaximoMaterialAcondicionamiento",
        {min: 0},
    );
    validateNumeric(payload.pesoMaximoProductoTerminado || 0, "pesoMaximoProductoTerminado", {min: 0});
    const db = getDb();
    const ref = db.collection(RACK_COLLECTION).doc();
    const rack = {
      ...payload,
      id: ref.id,
      estatus: payload.estatus || "activo",
      espacioOcupado: Number(payload.espacioOcupado || 0),
      ocupacionActual: Number(payload.ocupacionActual || 0),
      capacidadTotal: Number(payload.capacidadTotal || 0),
      fechaCreacion: new Date().toISOString(),
      fechaActualizacion: new Date().toISOString(),
    };
    await ref.set(rack);
    return getDefaultResponse(true, rack, "Rack creado correctamente");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error creando rack");
  }
});

const actualizarRack = makeApiHandler(async (request) => {
  try {
    const {id, updates} = request.data || {};
    if (!id) {
      throw new Error("Debe indicar el id del rack.");
    }
    const payload = buildRackDocPayload(updates || {});
    const db = getDb();
    const ref = db.collection(RACK_COLLECTION).doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error("El rack no existe.");
    }
    payload.fechaActualizacion = new Date().toISOString();
    await ref.update(payload);
    const updated = await ref.get();
    return getDefaultResponse(true, updated.data(), "Rack actualizado");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error actualizando rack");
  }
});

const eliminarRack = makeApiHandler(async (request) => {
  try {
    const id = request.data && request.data.id ? request.data.id : null;
    if (!id) {
      throw new Error("Debe indicar el id del rack.");
    }
    const db = getDb();
    const ref = db.collection(RACK_COLLECTION).doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error("El rack no existe.");
    }
    await ref.delete();
    return getDefaultResponse(true, {id}, "Rack eliminado");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error eliminando rack");
  }
});

const obtenerRacks = makeApiHandler(async () => {
  try {
    const snapshot = await getDb().collection(RACK_COLLECTION).orderBy("numeroRack", "asc").get();
    const racks = snapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
    return getDefaultResponse(true, racks, "Racks obtenidos correctamente");
  } catch (error) {
    return getDefaultResponse(false, [], error.message || "Error obteniendo racks");
  }
});

const suscribirRacks = makeApiHandler(async () => {
  return getDefaultResponse(true, [], "Suscripción de racks disponible en Firestore real-time");
});

const registrarMovimiento = makeApiHandler(async (request) => {
  try {
    const payload = buildMovementRecord(request.data || {});
    validateRequired(payload, ["rackId", "itemId", "tipoMovimiento", "cantidad"], "Movimiento");
    const db = getDb();
    const movement = {
      ...payload,
      cantidad: Number(payload.cantidad),
      fecha: normalizeDate(payload.fecha || new Date(), new Date()),
      observacion: payload.observacion || "",
      usuario: payload.usuario || {id: "system", nombre: "Sistema"},
      createdAt: new Date().toISOString(),
    };
    const ref = db.collection(MOVEMENTS_COLLECTION).doc();
    await ref.set({...movement, id: ref.id});
    return getDefaultResponse(true, {...movement, id: ref.id}, "Movimiento registrado");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error registrando movimiento");
  }
});

const obtenerMovimientosPorRack = makeApiHandler(async (request) => {
  try {
    const rackId = getRackReference(
      request.data && request.data.rackId ? request.data.rackId : null,
    );
    if (!rackId) {
      throw new Error("Debe indicar el rackId");
    }
    const snapshot = await getDb().collection(MOVEMENTS_COLLECTION)
        .where("rackId", "==", rackId)
        .orderBy("createdAt", "desc")
        .get();
    const movements = snapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
    return getDefaultResponse(true, movements, "Movimientos por rack obtenidos");
  } catch (error) {
    return getDefaultResponse(false, [], error.message || "Error obteniendo movimientos por rack");
  }
});

const obtenerMovimientosPorFecha = makeApiHandler(async (request) => {
  try {
    const {rackId, fechaInicio, fechaFin} = request.data || {};
    if (!rackId) {
      throw new Error("Debe indicar el rackId");
    }
    const start = normalizeDate(fechaInicio || new Date(), new Date());
    const end = normalizeDate(fechaFin || new Date(), new Date());
    const snapshot = await getDb().collection(MOVEMENTS_COLLECTION)
        .where("rackId", "==", rackId)
        .where("fecha", ">=", start)
        .where("fecha", "<=", end)
        .orderBy("fecha", "desc")
        .get();
    const movements = snapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
    return getDefaultResponse(true, movements, "Movimientos por fecha obtenidos");
  } catch (error) {
    return getDefaultResponse(false, [], error.message || "Error obteniendo movimientos por fecha");
  }
});

const suscribirMovimientos = makeApiHandler(async (request) => {
  try {
    const payload = request && request.data ? request.data : {};
    const rackId = payload.rackId ? getRackReference(payload.rackId) : null;
    let query = getDb().collection(MOVEMENTS_COLLECTION);
    if (rackId) {
      query = query.where("rackId", "==", rackId);
    }
    const snapshot = await query.orderBy("createdAt", "desc").get();
    const movimientos = snapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
    return getDefaultResponse(true, movimientos, rackId ?
      "Movimientos del rack obtenidos en tiempo real" :
      "Movimientos disponibles en Firestore real-time");
  } catch (error) {
    return getDefaultResponse(false, [], error.message || "Error consultando movimientos");
  }
});

const vaciarRack = makeApiHandler(async (request) => {
  try {
    const rackId = request.data && request.data.id ? request.data.id :
      request.data && request.data.rackId ? request.data.rackId : null;
    if (!rackId) {
      throw new Error("Debe indicar el id del rack");
    }
    const db = getDb();
    const stockSnapshot = await db.collection("pepsRackStock")
        .where("rackId", "==", rackId)
        .get();
    const batch = db.batch();
    stockSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    return getDefaultResponse(true, {rackId}, "Rack vaciado correctamente");
  } catch (error) {
    return getDefaultResponse(false, null, error.message || "Error vaciando rack");
  }
});

const lockRack = makeApiHandler(async (request) => {
  try {
    const payload = request.data || {};
    const action = payload.action || "lock";
    const rackId = getRackReference(payload.rackId || payload.id || null);
    const user = payload.user || payload.usuario || {};
    const currentUserId = user.id ?? user.uid ?? user.userId ?? null;
    const currentUserName = user.nombre || user.name || user.userName || user.displayName || "Sistema";

    if (!rackId) {
      throw new Error("Debe indicar el rackId.");
    }

    const db = getDb();
    const lockRef = db.collection(RACK_LOCK_COLLECTION).doc(rackId);

    if (action === "unlock") {
      await lockRef.delete();
      return getDefaultResponse(true, {rackId, isLocked: false}, "Rack desbloqueado correctamente");
    }

    let sameUserAlreadyLocked = false;

    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(lockRef);
      if (snapshot.exists) {
        const data = snapshot.data() || {};
        const expiresAt = parseRackLockExpiration(data);
        if (expiresAt > Date.now()) {
          const existingUserId = data.userId ?? data.user?.id ??
            data.user?.uid ?? data.user?.userId ?? null;
          if (
            existingUserId !== null &&
            currentUserId !== null &&
            String(existingUserId) === String(currentUserId)
          ) {
            sameUserAlreadyLocked = true;
            transaction.update(lockRef, {
              userId: currentUserId,
              userName: currentUserName,
              expiresAt: new Date(Date.now() + RACK_LOCK_TIME_MS),
              isLocked: true,
              updatedAt: new Date(),
            });
            return;
          }

          const ownerName = data.userName || data.user?.nombre ||
            data.user?.name || data.user?.userName || "otro usuario";
          throw new Error(JSON.stringify({
            code: "LOCK_EXISTS",
            message: `Este rack ya está siendo utilizado por ${ownerName}.`,
          }));
        }
      }

      transaction.set(lockRef, {
        rackId,
        userId: currentUserId || "system",
        userName: currentUserName,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + RACK_LOCK_TIME_MS),
        isLocked: true,
        updatedAt: new Date(),
      });
    });

    if (sameUserAlreadyLocked) {
      return getDefaultResponse(true, {rackId, isLocked: true}, "Rack bloqueado correctamente");
    }

    return getDefaultResponse(true, {rackId, isLocked: true}, "Rack bloqueado correctamente");
  } catch (error) {
    const message = error && error.message ? error.message : "Error bloqueando rack";
    if (message.includes("LOCK_EXISTS")) {
      let lockMessage = "Otro usuario ya está utilizando este rack.";
      try {
        const parsed = JSON.parse(message);
        if (parsed && parsed.message) {
          lockMessage = parsed.message;
        }
      } catch (errorParse) {
        // No se hace nada y se conserva el mensaje por defecto.
      }
      return getDefaultResponse(false, {lock: false}, lockMessage);
    }

    return getDefaultResponse(false, null, message || "Error bloqueando rack");
  }
});

module.exports = {
  crearRack,
  actualizarRack,
  eliminarRack,
  suscribirRacks,
  obtenerRacks,
  obtenerMovimientosPorRack,
  registrarMovimiento,
  obtenerMovimientosPorFecha,
  suscribirMovimientos,
  vaciarRack,
  lockRack,
};
