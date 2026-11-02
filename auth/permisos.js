// Matriz de permisos por rol. Es la única fuente de verdad: el frontend recibe la lista
// de permisos del usuario en /api/auth/yo y solo oculta lo que no corresponde.

const TODOS = ['ADMINISTRADOR', 'COORDINADOR', 'OPERARIO', 'CONSULTA'];
const OPERACION = ['ADMINISTRADOR', 'COORDINADOR', 'OPERARIO'];
const SUPERVISION = ['ADMINISTRADOR', 'COORDINADOR'];

const PERMISOS = {
  'inventario:ver': TODOS,          // dashboard, inventario, historial y solicitudes
  'movimientos:registrar': OPERACION, // ingresos y retiros
  'productos:reubicar': OPERACION,
  'productos:inactivar': SUPERVISION, // borrado lógico con justificación (y reactivar)
  'productos:eliminar': ['ADMINISTRADOR'], // borrado físico, solo productos sin movimientos
  'productos:editar': SUPERVISION,   // descripción, categoría, talla, condición, grupo, stock mínimo
  'sbo:crear': OPERACION,           // crear y editar ítems mientras está CREADA
  'sbo:alistar': OPERACION,         // iniciar y finalizar alistamiento
  'sbo:aprobar': SUPERVISION,
  'sbo:despachar': SUPERVISION,
  'sbo:cancelar': SUPERVISION,
  'sbo:renovar': SUPERVISION,       // reinicia el conteo de vencimiento
  'configuracion:gestionar': SUPERVISION, // catálogos y parámetros
  'conciliacion:aprobar': SUPERVISION, // Fase G: aprobar o anular conteos (ajustes de stock) y ver la consistencia
  'usuarios:gestionar': ['ADMINISTRADOR']
};

// Permiso que exige cada acción de la máquina de estados de SBO
const PERMISO_TRANSICION = {
  aprobar: 'sbo:aprobar',
  iniciar: 'sbo:alistar',
  finalizar: 'sbo:alistar',
  despachar: 'sbo:despachar',
  cancelar: 'sbo:cancelar',
  renovar: 'sbo:renovar'
};

const ROLES_ALISTADORES = ['OPERARIO', 'COORDINADOR'];

const tienePermiso = (rol, permiso) => (PERMISOS[permiso] || []).includes(rol);
const permisosDe = (rol) => Object.keys(PERMISOS).filter(p => tienePermiso(rol, p));

module.exports = { PERMISOS, PERMISO_TRANSICION, ROLES_ALISTADORES, tienePermiso, permisosDe };
