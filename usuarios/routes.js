const express = require('express');
const { Rol } = require('@prisma/client');
const prisma = require('../lib/prisma');
const { manejarError } = require('../lib/errores');
const { StockError } = require('../lib/stock');
const { autorizar } = require('../auth/middleware');
const { ROLES_ALISTADORES } = require('../auth/permisos');
const { cifrarPassword, generarPasswordTemporal, usuarioPublico } = require('../auth/credenciales');

const router = express.Router();
const ROLES = Object.values(Rol);
const FORMATO_USUARIO = /^[A-Za-z0-9._-]{3,30}$/;

const idDe = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new StockError(404, 'El usuario no existe.');
  return id;
};

const revocarSesiones = (tx, usuarioId) =>
  tx.sesionRefresh.updateMany({ where: { usuarioId, revocada_en: null }, data: { revocada_en: new Date() } });

// Personas que pueden alistar una SBO (lo usa la pantalla de Solicitudes)
router.get('/alistadores', autorizar('inventario:ver'), async (req, res) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      where: { activo: true, rol: { in: ROLES_ALISTADORES } },
      select: { usuario: true, nombre: true },
      orderBy: { usuario: 'asc' }
    });
    res.json(usuarios);
  } catch (error) {
    manejarError(res, error, 'Error al obtener los alistadores');
  }
});

// --- Gestión de usuarios: solo Administrador ---
router.use(autorizar('usuarios:gestionar'));

router.get('/', async (req, res) => {
  try {
    const usuarios = await prisma.usuario.findMany({ orderBy: [{ activo: 'desc' }, { usuario: 'asc' }] });
    res.json(usuarios.map(u => ({ ...usuarioPublico(u), bloqueado_hasta: u.bloqueado_hasta, creado_en: u.creado_en })));
  } catch (error) {
    manejarError(res, error, 'Error al obtener los usuarios');
  }
});

// Crear usuario: la contraseña temporal se devuelve UNA vez y debe cambiarse en el primer ingreso
router.post('/', async (req, res) => {
  try {
    const nombre = typeof req.body?.nombre === 'string' ? req.body.nombre.trim() : '';
    const usuario = typeof req.body?.usuario === 'string' ? req.body.usuario.trim() : '';
    const rol = req.body?.rol;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });
    if (!FORMATO_USUARIO.test(usuario)) return res.status(400).json({ error: 'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo.' });
    if (!ROLES.includes(rol)) return res.status(400).json({ error: `Rol inválido. Use: ${ROLES.join(', ')}.` });

    const existente = await prisma.usuario.findFirst({ where: { usuario: { equals: usuario, mode: 'insensitive' } } });
    if (existente) return res.status(409).json({ error: `Ya existe el usuario "${existente.usuario}".` });

    const passwordTemporal = generarPasswordTemporal();
    const creado = await prisma.usuario.create({
      data: { nombre, usuario, rol, password_hash: await cifrarPassword(passwordTemporal), debe_cambiar_password: true }
    });
    res.status(201).json({ usuario: usuarioPublico(creado), passwordTemporal });
  } catch (error) {
    manejarError(res, error, 'Error al crear el usuario');
  }
});

// Cambiar nombre, rol o estado (activo/inactivo)
router.patch('/:id', async (req, res) => {
  try {
    const id = idDe(req);
    const { nombre, rol, activo } = req.body || {};
    const datos = {};
    if (nombre !== undefined) {
      if (typeof nombre !== 'string' || !nombre.trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío.' });
      datos.nombre = nombre.trim();
    }
    if (rol !== undefined) {
      if (!ROLES.includes(rol)) return res.status(400).json({ error: `Rol inválido. Use: ${ROLES.join(', ')}.` });
      datos.rol = rol;
    }
    if (activo !== undefined) {
      if (typeof activo !== 'boolean') return res.status(400).json({ error: 'El campo "activo" debe ser verdadero o falso.' });
      datos.activo = activo;
    }
    if (id === req.usuario.id && (datos.activo === false || (datos.rol && datos.rol !== 'ADMINISTRADOR'))) {
      return res.status(400).json({ error: 'No puede desactivarse ni quitarse el rol de Administrador a sí mismo.' });
    }

    const actualizado = await prisma.$transaction(async (tx) => {
      const actual = await tx.usuario.findUnique({ where: { id } });
      if (!actual) throw new StockError(404, 'El usuario no existe.');

      // Siempre debe quedar al menos un Administrador activo
      const dejaDeSerAdmin = actual.rol === 'ADMINISTRADOR' && actual.activo &&
        ((datos.rol && datos.rol !== 'ADMINISTRADOR') || datos.activo === false);
      if (dejaDeSerAdmin) {
        const admins = await tx.usuario.count({ where: { rol: 'ADMINISTRADOR', activo: true } });
        if (admins <= 1) throw new StockError(409, 'Debe quedar al menos un Administrador activo.');
      }

      const u = await tx.usuario.update({ where: { id }, data: datos });
      if (datos.activo === false) await revocarSesiones(tx, id);
      return u;
    });
    res.json(usuarioPublico(actualizado));
  } catch (error) {
    manejarError(res, error, 'Error al actualizar el usuario');
  }
});

// Restablecer contraseña: genera una temporal, desbloquea y cierra sus sesiones
router.post('/:id/restablecer', async (req, res) => {
  try {
    const id = idDe(req);
    const passwordTemporal = generarPasswordTemporal();
    const hash = await cifrarPassword(passwordTemporal);
    const actualizado = await prisma.$transaction(async (tx) => {
      const u = await tx.usuario.update({
        where: { id },
        data: { password_hash: hash, debe_cambiar_password: true, intentos_fallidos: 0, bloqueado_hasta: null }
      });
      await revocarSesiones(tx, id);
      return u;
    });
    res.json({ usuario: usuarioPublico(actualizado), passwordTemporal });
  } catch (error) {
    manejarError(res, error, 'Error al restablecer la contraseña');
  }
});

module.exports = router;
