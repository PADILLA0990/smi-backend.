const express = require('express');
const cors = require('cors');
const prisma = require('./lib/prisma');
const { manejarError, campoFaltante } = require('./lib/errores');
const productosRoutes = require('./productos/routes');
const solicitudesRoutes = require('./solicitudes/routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de middlewares
app.use(cors());
app.use(express.json()); // Permite al servidor entender datos en formato JSON

// Ruta de prueba para verificar que el servidor vive
app.get('/', (req, res) => {
  res.send('API del Banco de Alimentos funcionando correctamente');
});

// --- INVENTARIO: productos, ingresos, reubicación, eliminación y salidas ---
// Cada operación registra su propio historial en la misma transacción
app.use('/api', productosRoutes);

// --- RUTAS PARA LA AUDITORÍA (HISTORIAL) ---

// 1. Guardar un movimiento manual en el historial
app.post('/api/historial', async (req, res) => {
  try {
    const faltante = campoFaltante(req.body, ['codigo_producto', 'accion', 'operario']);
    if (faltante) {
      return res.status(400).json({ error: `El campo "${faltante}" es obligatorio.` });
    }
    const { codigo_producto, accion, operario, detalles } = req.body;
    const nuevoRegistro = await prisma.historial.create({
      data: { codigo_producto, accion, operario, detalles }
    });
    res.status(201).json(nuevoRegistro);
  } catch (error) {
    manejarError(res, error, 'Error al registrar el movimiento');
  }
});

// 2. Obtener todo el historial (del más reciente al más antiguo)
app.get('/api/historial', async (req, res) => {
  try {
    const registros = await prisma.historial.findMany({
      orderBy: { fecha: 'desc' } // Ordena por fecha descendente
    });
    res.json(registros);
  } catch (error) {
    manejarError(res, error, 'Error al obtener los registros');
  }
});

// --- MÓDULO DE SOLICITUDES SBO ---
app.use('/api/solicitudes', solicitudesRoutes);

// JSON mal formado u otros errores no capturados: respuesta clara en vez de una página HTML
app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la petición no es un JSON válido.' });
  }
  manejarError(res, error, 'Error interno del servidor');
});

// Inicializar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
