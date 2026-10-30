// Contraseñas (bcrypt), tokens de acceso (JWT) y tokens de sesión (aleatorios, guardados como SHA-256)
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, ACCESO_MINUTOS } = require('../lib/config');
const { permisosDe } = require('./permisos');

const COSTO_BCRYPT = 12;
const EMISOR = 'smi-controlbab';

const cifrarPassword = (password) => bcrypt.hash(password, COSTO_BCRYPT);
const compararPassword = (password, hash) => bcrypt.compare(password, hash);

// Hash fijo para comparar cuando el usuario no existe: el tiempo de respuesta no revela si existe
const HASH_SEÑUELO = bcrypt.hashSync('usuario-inexistente-señuelo', COSTO_BCRYPT);

// Política: mínimo 10 caracteres, con al menos una letra y un número
function errorPoliticaPassword(password) {
  if (typeof password !== 'string' || password.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (password.length > 72) return 'La contraseña no puede tener más de 72 caracteres.';
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(password) || !/\d/.test(password)) return 'La contraseña debe combinar letras y números.';
  return null;
}

// Contraseña temporal legible (sin caracteres que se confunden: 0/O, 1/l/I)
function generarPasswordTemporal() {
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const numeros = '23456789';
  const todos = letras + numeros;
  const elegir = (conjunto) => conjunto[crypto.randomInt(conjunto.length)];
  const caracteres = [elegir(letras), elegir(numeros), ...Array.from({ length: 10 }, () => elegir(todos))];
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return caracteres.join('');
}

const firmarAcceso = (usuario) => jwt.sign(
  { sub: String(usuario.id), usuario: usuario.usuario, rol: usuario.rol },
  JWT_SECRET,
  { expiresIn: `${ACCESO_MINUTOS}m`, issuer: EMISOR, algorithm: 'HS256' }
);

const verificarAcceso = (token) => jwt.verify(token, JWT_SECRET, { issuer: EMISOR, algorithms: ['HS256'] });

const generarTokenSesion = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Datos del usuario que se pueden enviar al navegador (nunca el hash)
const usuarioPublico = (u) => ({
  id: u.id,
  nombre: u.nombre,
  usuario: u.usuario,
  rol: u.rol,
  activo: u.activo,
  debe_cambiar_password: u.debe_cambiar_password,
  ultimo_acceso: u.ultimo_acceso,
  permisos: permisosDe(u.rol)
});

module.exports = {
  cifrarPassword, compararPassword, HASH_SEÑUELO, errorPoliticaPassword, generarPasswordTemporal,
  firmarAcceso, verificarAcceso, generarTokenSesion, hashToken, usuarioPublico
};
