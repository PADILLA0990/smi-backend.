const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./lib/config');
const prisma = require('./lib/prisma');
const { manejarError } = require('./lib/errores');
const { autenticar, autorizar } = require('./auth/middleware');
const authRoutes = require('./auth/routes');
const usuariosRoutes = require('./usuarios/routes');
const productosRoutes = require('./productos/routes');
const solicitudesRoutes = require('./solicitudes/routes');

const app = express();

// --- Seguridad básica ---
app.set('trust proxy', config.TRUST_PROXY); // IP real del cliente detrás de Vercel y Render
app.use(helmet()); // encabezados de seguridad y sin "X-Powered-By"
app.use(cors({
  // Solo el frontend propio puede llamar a la API desde un navegador
  origin: (origen, listo) => listo(null, !origen || config.CORS_ORIGINS.includes(origen)),
  credentials: true
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Ruta de prueba para verificar que el servidor vive (pública)
app.get('/', (req, res) => {
  res.send('API del Banco de Alimentos funcionando correctamente');
});

// --- Autenticación (login y refresco son públicos) ---
app.use('/api/auth', authRoutes);

// --- Todo lo demás exige sesión ---
app.use('/api', autenticar());

app.use('/api/usuarios', usuariosRoutes);

// Inventario: productos, ingresos, reubicación, eliminación y salidas.
// Cada operación registra su propio historial en la misma transacción.
app.use('/api', productosRoutes);

// Historial (solo lectura: ya no se puede escribir directamente desde el navegador)
app.get('/api/historial', autorizar('inventario:ver'), async (req, res) => {
  try {
    const registros = await prisma.historial.findMany({ orderBy: { fecha: 'desc' } });
    res.json(registros);
  } catch (error) {
    manejarError(res, error, 'Error al obtener los registros');
  }
});

app.use('/api/solicitudes', solicitudesRoutes);

// Ruta de API inexistente
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

// JSON mal formado u otros errores no capturados: respuesta clara en vez de una página HTML
app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la petición no es un JSON válido.' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'La petición es demasiado grande.' });
  }
  manejarError(res, error, 'Error interno del servidor');
});

module.exports = app;
