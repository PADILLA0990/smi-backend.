const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const { manejarError } = require('../lib/errores');
const config = require('../lib/config');
const {
  compararPassword, cifrarPassword, HASH_SEÑUELO, errorPoliticaPassword,
  firmarAcceso, generarTokenSesion, hashToken, usuarioPublico
} = require('./credenciales');
const { autenticar } = require('./middleware');

const router = express.Router();

const COOKIE = 'smi_sesion';
const MARGEN_CARRERA_MS = 30 * 1000;
const opcionesCookie = () => ({
  httpOnly: true,
  secure: config.COOKIE_SEGURA,
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: config.SESION_HORAS * 60 * 60 * 1000
});

// Límite por IP de intentos fallidos (además del bloqueo por usuario)
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.LIMITE_LOGIN_IP,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos fallidos desde esta red. Espere 15 minutos e intente de nuevo.', codigo: 'LIMITE_INTENTOS' }
});

// Crea una sesión nueva, deja el token en la cookie y devuelve el token de acceso
async function abrirSesion(req, res, usuario, db = prisma) {
  const token = generarTokenSesion();
  await db.sesionRefresh.create({
    data: {
      usuarioId: usuario.id,
      token_hash: hashToken(token),
      expira: new Date(Date.now() + config.SESION_HORAS * 60 * 60 * 1000),
      ip: req.ip,
      user_agent: (req.get('user-agent') || '').slice(0, 300)
    }
  });
  res.cookie(COOKIE, token, opcionesCookie());
  return { accessToken: firmarAcceso(usuario), usuario: usuarioPublico(usuario) };
}

const credencialesInvalidas = (res) =>
  res.status(401).json({ error: 'Usuario o contraseña incorrectos.', codigo: 'CREDENCIALES_INVALIDAS' });

// Iniciar sesión
router.post('/login', limiteLogin, async (req, res) => {
  try {
    const usuarioTexto = typeof req.body?.usuario === 'string' ? req.body.usuario.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!usuarioTexto || !password) {
      return res.status(400).json({ error: 'Ingrese usuario y contraseña.' });
    }

    const usuario = await prisma.usuario.findFirst({ where: { usuario: { equals: usuarioTexto, mode: 'insensitive' } } });
    if (!usuario || !usuario.activo) {
      await compararPassword(password, HASH_SEÑUELO); // mismo tiempo de respuesta exista o no
      return credencialesInvalidas(res);
    }

    if (usuario.bloqueado_hasta && usuario.bloqueado_hasta > new Date()) {
      const minutos = Math.ceil((usuario.bloqueado_hasta - Date.now()) / 60000);
      return res.status(423).json({ error: `Usuario bloqueado por intentos fallidos. Intente de nuevo en ${minutos} minuto(s).`, codigo: 'USUARIO_BLOQUEADO' });
    }

    if (!(await compararPassword(password, usuario.password_hash))) {
      const intentos = usuario.intentos_fallidos + 1;
      const bloquear = intentos >= config.MAX_INTENTOS;
      await prisma.usuario.update({
        where: { id: usuario.id },
        data: bloquear
          ? { intentos_fallidos: 0, bloqueado_hasta: new Date(Date.now() + config.BLOQUEO_MINUTOS * 60000) }
          : { intentos_fallidos: intentos }
      });
      if (bloquear) {
        return res.status(423).json({ error: `Demasiados intentos fallidos. El usuario quedó bloqueado ${config.BLOQUEO_MINUTOS} minutos.`, codigo: 'USUARIO_BLOQUEADO' });
      }
      return credencialesInvalidas(res);
    }

    const actualizado = await prisma.usuario.update({
      where: { id: usuario.id },
      data: { intentos_fallidos: 0, bloqueado_hasta: null, ultimo_acceso: new Date() }
    });
    res.json(await abrirSesion(req, res, actualizado));
  } catch (error) {
    manejarError(res, error, 'Error al iniciar sesión');
  }
});

// Renovar el token de acceso con la cookie de sesión (y rotar la cookie)
router.post('/refresh', async (req, res) => {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) {
      return res.status(401).json({ error: 'No hay una sesión activa.', codigo: 'SIN_SESION' });
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const sesion = await tx.sesionRefresh.findUnique({ where: { token_hash: hashToken(token) }, include: { usuario: true } });
      if (!sesion) return null;

      // Un token ya usado que vuelve a aparecer indica robo: se cierran todas las sesiones del usuario.
      // Si se usó hace segundos es una carrera normal (dos peticiones a la vez), no un robo.
      if (sesion.revocada_en) {
        if (Date.now() - sesion.revocada_en.getTime() > MARGEN_CARRERA_MS) {
          await tx.sesionRefresh.updateMany({ where: { usuarioId: sesion.usuarioId, revocada_en: null }, data: { revocada_en: new Date() } });
        }
        return null;
      }
      if (sesion.expira < new Date() || !sesion.usuario.activo) return null;

      // Revocación condicional: si dos pestañas renuevan a la vez, solo una gana
      const { count } = await tx.sesionRefresh.updateMany({ where: { id: sesion.id, revocada_en: null }, data: { revocada_en: new Date() } });
      if (count === 0) return null;
      return abrirSesion(req, res, sesion.usuario, tx);
    });

    if (!resultado) {
      res.clearCookie(COOKIE, { ...opcionesCookie(), maxAge: undefined });
      return res.status(401).json({ error: 'La sesión expiró. Inicie sesión de nuevo.', codigo: 'SESION_VENCIDA' });
    }
    res.json(resultado);
  } catch (error) {
    manejarError(res, error, 'Error al renovar la sesión');
  }
});

// Cerrar sesión
router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies?.[COOKIE];
    if (token) {
      await prisma.sesionRefresh.updateMany({ where: { token_hash: hashToken(token), revocada_en: null }, data: { revocada_en: new Date() } });
    }
    res.clearCookie(COOKIE, { ...opcionesCookie(), maxAge: undefined });
    res.json({ message: 'Sesión cerrada' });
  } catch (error) {
    manejarError(res, error, 'Error al cerrar la sesión');
  }
});

// Datos del usuario conectado y sus permisos
router.get('/yo', autenticar({ permitirCambioPendiente: true }), (req, res) => {
  res.json(usuarioPublico(req.usuario));
});

// Cambiar la contraseña propia (obligatorio en el primer ingreso)
router.post('/cambiar-password', autenticar({ permitirCambioPendiente: true }), async (req, res) => {
  try {
    const { actual, nueva } = req.body || {};
    if (typeof actual !== 'string' || !(await compararPassword(actual, req.usuario.password_hash))) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
    }
    const errorPolitica = errorPoliticaPassword(nueva);
    if (errorPolitica) return res.status(400).json({ error: errorPolitica });
    if (nueva === actual) return res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la actual.' });

    const actualizado = await prisma.$transaction(async (tx) => {
      const u = await tx.usuario.update({
        where: { id: req.usuario.id },
        data: { password_hash: await cifrarPassword(nueva), debe_cambiar_password: false }
      });
      // Cierra las demás sesiones abiertas con la contraseña anterior
      const tokenActual = req.cookies?.[COOKIE];
      await tx.sesionRefresh.updateMany({
        where: { usuarioId: u.id, revocada_en: null, ...(tokenActual ? { NOT: { token_hash: hashToken(tokenActual) } } : {}) },
        data: { revocada_en: new Date() }
      });
      return u;
    });

    res.json({ accessToken: firmarAcceso(actualizado), usuario: usuarioPublico(actualizado) });
  } catch (error) {
    manejarError(res, error, 'Error al cambiar la contraseña');
  }
});

module.exports = router;
