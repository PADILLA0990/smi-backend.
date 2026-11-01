// Máquina de estados de las Solicitudes SBO.
// Cada acción define desde qué estados se permite y a cuál lleva.
//
// CREADA ─aprobar─▶ APROBADA ─iniciar─▶ EN_ALISTAMIENTO ─finalizar─▶ ALISTADA ─despachar─▶ DESPACHADA
//   └──────────────────┴───────────────────────┴──────────────────────┴──cancelar──▶ CANCELADA
//   └──────────────────┴───────────────────────┴──────────────────────┴──(sistema)──▶ VENCIDA
//
// Aprobar reserva el stock; cancelar y vencer lo liberan; despachar descuenta lo alistado y libera la reserva.
// Renovar no cambia el estado: reinicia el conteo de días sin movimiento (Fase D3).
// Vencer solo lo ejecuta el sistema (lib/solicitudes.js), nunca un usuario por la API.

const ACTIVOS = ['CREADA', 'APROBADA', 'EN_ALISTAMIENTO', 'ALISTADA'];

const TRANSICIONES = {
  aprobar:   { desde: ['CREADA'],          hacia: 'APROBADA',        fecha: 'fecha_aprobacion' },
  iniciar:   { desde: ['APROBADA'],        hacia: 'EN_ALISTAMIENTO', fecha: 'fecha_inicio_alistamiento' },
  finalizar: { desde: ['EN_ALISTAMIENTO'], hacia: 'ALISTADA',        fecha: 'fecha_fin_alistamiento' },
  despachar: { desde: ['ALISTADA'],        hacia: 'DESPACHADA',      fecha: 'fecha_despacho' },
  cancelar:  { desde: ACTIVOS,             hacia: 'CANCELADA',       fecha: 'fecha_cancelacion' },
  renovar:   { desde: ACTIVOS,             hacia: null },            // se queda en el mismo estado
  vencer:    { desde: ACTIVOS,             hacia: 'VENCIDA',         fecha: 'fecha_vencimiento', sistema: true }
};

// Devuelve la transición si es válida, o un mensaje de error si no lo es
function validarTransicion(estadoActual, accion) {
  const transicion = TRANSICIONES[accion];
  if (!transicion || transicion.sistema) {
    return { error: `Acción desconocida: ${accion}` };
  }
  if (!transicion.desde.includes(estadoActual)) {
    return { error: `No se puede "${accion}" una solicitud en estado ${estadoActual}.` };
  }
  return { transicion: { ...transicion, hacia: transicion.hacia || estadoActual } };
}

// Acciones de usuario disponibles para un estado (útil para pintar botones en el frontend)
function accionesDisponibles(estado) {
  return Object.keys(TRANSICIONES).filter(accion => !TRANSICIONES[accion].sistema && TRANSICIONES[accion].desde.includes(estado));
}

module.exports = { TRANSICIONES, ACTIVOS, validarTransicion, accionesDisponibles };
