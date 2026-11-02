const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./lib/config');
const { manejarError } = require('./lib/errores');
const { autenticar } = require('./auth/middleware');
const authRoutes = require('./auth/routes');
const usuariosRoutes = require('./usuarios/routes');
const productosRoutes = require('./productos/routes');
const solicitudesRoutes = require('./solicitudes/routes');
const historialRoutes = require('./historial/routes');
const documentosRoutes = require('./documentos/routes');
const dashboardRoutes = require('./dashboard/routes');
const estanteriasRoutes = require('./estanterias/routes');
const codificacionRoutes = require('./codificacion/routes');
const { router: catalogosRoutes } = require('./catalogos/routes');

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

// Versión que está corriendo (pública): permite confirmar un despliegue en Render sin iniciar sesión.
// RENDER_GIT_COMMIT lo define Render en cada despliegue.
const ARRANQUE = new Date().toISOString();
app.get('/version', (req, res) => {
  res.json({ commit: (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7), arranque: ARRANQUE });
});

// --- Autenticación (login y refresco son públicos) ---
app.use('/api/auth', authRoutes);

// --- Todo lo demás exige sesión ---
app.use('/api', autenticar());

app.use('/api/usuarios', usuariosRoutes);

// Inventario: productos, ingresos, reubicación, eliminación y salidas.
// Cada operación registra su propio historial en la misma transacción.
app.use('/api', productosRoutes);

// Historial (solo lectura, con filtros y paginación)
app.use('/api', historialRoutes);

// Documentos de ingreso y salida de varias líneas (Fase D2)
app.use('/api', documentosRoutes);

app.use('/api/solicitudes', solicitudesRoutes);

// Resumen del panel principal (Fase D4)
app.use('/api', dashboardRoutes);

// Mapa de Bodega: estanterías y contenido del mapa
app.use('/api', estanteriasRoutes);

// Codificación de productos 001-RCM-B
app.use('/api', codificacionRoutes);

// Catálogos, parámetros y ubicaciones (estas últimas las consume el Mapa de Bodega)
app.use('/api', catalogosRoutes);

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
