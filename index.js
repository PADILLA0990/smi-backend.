// Punto de entrada: la configuración de la app está en app.js
const app = require('./app');
const { PUERTO } = require('./lib/config');
const prisma = require('./lib/prisma');
const { revisarVencimientos } = require('./lib/solicitudes');

const UNA_HORA = 60 * 60 * 1000;

app.listen(PUERTO, () => {
  console.log(`Servidor corriendo en http://localhost:${PUERTO}`);
  // Vence las SBO sin movimiento al arrancar (la tarea diaria de GitHub despierta el servidor) y cada hora
  revisarVencimientos(prisma);
  setInterval(() => revisarVencimientos(prisma), UNA_HORA).unref();
});
