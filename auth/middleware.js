const prisma = require('../lib/prisma');
const { verificarAcceso } = require('./credenciales');
const { tienePermiso } = require('./permisos');

// Exige un token de acceso válido (Authorization: Bearer ...) y deja el usuario en req.usuario.
// El usuario se lee de la base en cada petición: desactivar o cambiar el rol aplica de inmediato.
// opciones.permitirCambioPendiente: deja pasar aunque deba cambiar la contraseña (rutas de /auth)
function autenticar({ permitirCambioPendiente = false } = {}) {
  return async (req, res, next) => {
    const [tipo, token] = (req.get('authorization') || '').split(' ');
    if (tipo !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Debe iniciar sesión.', codigo: 'SIN_SESION' });
    }

    let datos;
    try {
      datos = verificarAcceso(token);
    } catch (error) {
      const vencido = error.name === 'TokenExpiredError';
      return res.status(401).json({
        error: vencido ? 'La sesión expiró.' : 'Sesión inválida.',
        codigo: vencido ? 'TOKEN_VENCIDO' : 'TOKEN_INVALIDO'
      });
    }

    try {
      const usuario = await prisma.usuario.findUnique({ where: { id: Number(datos.sub) } });
      if (!usuario || !usuario.activo) {
        return res.status(401).json({ error: 'El usuario no existe o está desactivado.', codigo: 'USUARIO_INACTIVO' });
      }
      if (usuario.debe_cambiar_password && !permitirCambioPendiente) {
        return res.status(403).json({ error: 'Debe cambiar su contraseña antes de continuar.', codigo: 'DEBE_CAMBIAR_PASSWORD' });
      }
      req.usuario = usuario;
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Exige un permiso de la matriz (auth/permisos.js). Va después de autenticar().
const autorizar = (permiso) => (req, res, next) => {
  if (!tienePermiso(req.usuario?.rol, permiso)) {
    return res.status(403).json({ error: 'No tiene permiso para realizar esta acción.', codigo: 'SIN_PERMISO' });
  }
  next();
};

module.exports = { autenticar, autorizar };
