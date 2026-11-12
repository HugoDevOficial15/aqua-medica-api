Para levantar el emulador en esta aplicacion y poder hacer pruebas 
sin afectar la DB de producción se deben ejecutar los siguientes comandos:

**###########################################################################**

$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8180"
firebase emulators:start --only functions,firestore --project sii-aqua-medica.

**###########################################################################**

En el .env de la aplicación del SII poner esto en las claves correspondientes:

VITE_PEPS_BASE_URL=http://127.0.0.1:5101/sii-aqua-medica/us-central1

**###########################################################################**

Una vez termines de usar el emulador, regresa el .env del SII a su estado natural.

**###########################################################################**