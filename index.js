// Punto de entrada: la configuración de la app está en app.js
const app = require('./app');
const { PUERTO } = require('./lib/config');

app.listen(PUERTO, () => {
  console.log(`Servidor corriendo en http://localhost:${PUERTO}`);
});
