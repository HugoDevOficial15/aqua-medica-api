const DEFAULT_URL = process.env.API_BASE_URL ||
  "http://localhost:5001/sii-aqua-medica/us-central1/apiTestConnection";
const DEFAULT_API_KEY = process.env.API_KEY || "aqua-medica-dev-key";

async function testConnection(targetUrl = DEFAULT_URL, apiKey = DEFAULT_API_KEY) {
  const response = await fetch(targetUrl, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
  });

  const payload = await response.json().catch(() => ({}));

  console.log("Status HTTP:", response.status);
  console.log("Respuesta:", JSON.stringify(payload, null, 2));

  if (payload.ok) {
    console.log("\nConexión correcta: la otra app sí se conectó al backend.");
    return true;
  }

  console.log("\nNo se pudo establecer la conexión o falta autorización.");
  return false;
}

const targetUrl = process.argv[2] || DEFAULT_URL;
const apiKey = process.argv[3] || DEFAULT_API_KEY;

testConnection(targetUrl, apiKey)
    .then((connected) => process.exit(connected ? 0 : 1))
    .catch((error) => {
      console.error("Error de conexión:", error.message);
      process.exit(1);
    });
