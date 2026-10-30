// Configuración leída de variables de entorno (ver .env.example).
// Si falta algo indispensable, el servidor no arranca: es mejor fallar al inicio que correr inseguro.
require('dotenv').config();

const entero = (nombre, porDefecto) => {
  const valor = process.env[nombre];
  if (valor === undefined || valor === '') return porDefecto;
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`La variable ${nombre} debe ser un entero positivo.`);
  return n;
};

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('Falta JWT_SECRET (mínimo 32 caracteres). Genere uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"');
}

const produccion = process.env.NODE_ENV === 'production';

module.exports = {
  PUERTO: process.env.PORT || 3000,
  PRODUCCION: produccion,
  JWT_SECRET,
  // Token de acceso corto; la sesión se renueva con la cookie mientras dure el turno
  ACCESO_MINUTOS: entero('ACCESO_MINUTOS', 15),
  SESION_HORAS: entero('SESION_HORAS', 10),
  // Bloqueo por intentos fallidos
  MAX_INTENTOS: entero('MAX_INTENTOS', 5),
  BLOQUEO_MINUTOS: entero('BLOQUEO_MINUTOS', 15),
  // Intentos fallidos por IP cada 15 min. Es más alto que el de usuario porque toda la bodega
  // puede salir a internet con la misma IP.
  LIMITE_LOGIN_IP: entero('LIMITE_LOGIN_IP', 20),
  // Saltos de proxy delante del servidor: Vercel (reenvío de /api) + Render
  TRUST_PROXY: entero('TRUST_PROXY', 2),
  // Orígenes permitidos por CORS, separados por coma
  CORS_ORIGINS: (process.env.CORS_ORIGINS || 'https://smi-frontend-murex.vercel.app,http://localhost:5173')
    .split(',').map(o => o.trim()).filter(Boolean),
  // La cookie solo viaja por HTTPS (los navegadores la aceptan también en http://localhost)
  COOKIE_SEGURA: process.env.COOKIE_SEGURA !== 'false'
};
