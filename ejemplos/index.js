const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("../../config/firebase");

const LOCK_TIME = 5 * 60 * 1000;

exports.lockRack = onCall(async (request) => {

    const { action, rackId, user } = request.data;

    if (!rackId) {

        throw new HttpsError(
            "invalid-argument",
            "Rack inválido."
        );

    }

    const ref =
        db.collection("locks").doc(rackId);

    if (action === "unlock") {

        await ref.delete();

        return {
            ok: true
        };

    }

    try {

        await db.runTransaction(async (tx) => {

            const snap =
                await tx.get(ref);

            if (snap.exists) {

                const data =
                    snap.data();

                const expires =
                    data.expiresAt.toMillis();

                if (expires > Date.now()) {

                    throw new Error(
                        JSON.stringify({
                            code: "LOCK_EXISTS",
                            message: `Este rack ya está siendo utilizado por ${data.userName || "otro usuario"}.`
                        })
                    );

                }

            }

            tx.set(ref, {

                rackId,

                userId: user.id,

                userName: user.nombre,

                createdAt: new Date(),

                expiresAt: new Date(
                    Date.now() + LOCK_TIME
                )

            });

        });

        return {

            ok: true

        };

    } catch (e) {

        if (
            e.message?.includes("LOCK_EXISTS")
        ) {

            let lockMessage = "Otro usuario ya está utilizando este rack.";

            try {
                const parsed = JSON.parse(e.message);
                if (parsed?.message) {
                    lockMessage = parsed.message;
                }
            } catch {
                // No hacer nada, se conserva el mensaje por defecto.
            }

            return {

                ok: false,

                message: lockMessage

            };

        }

        console.error(e);

        throw new HttpsError(

            "internal",

            "Error interno."

        );

    }

});