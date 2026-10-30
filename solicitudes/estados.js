// Máquina de estados de las Solicitudes SBO.
// Cada acción define desde qué estados se permite y a cuál lleva.
//
// CREADA ─aprobar─▶ APROBADA ─iniciar─▶ EN_ALISTAMIENTO ─finalizar─▶ ALISTADA ─despachar─▶ DESPACHADA
//   └──────────────────┴───────────────────────┴──────────────────────┴──cancelar──▶ CANCELADA
//
// Aprobar reserva el stock; cancelar lo libera; despachar descuenta lo alistado y libera la reserva.

const TRANSICIONES = {
  aprobar:   { desde: ['CREADA'],                                   hacia: 'APROBADA',        fecha: 'fecha_aprobacion' },
  iniciar:   { desde: ['APROBADA'],                                 hacia: 'EN_ALISTAMIENTO', fecha: 'fecha_inicio_alistamiento' },
  finalizar: { desde: ['EN_ALISTAMIENTO'],                          hacia: 'ALISTADA',        fecha: 'fecha_fin_alistamiento' },
  despachar: { desde: ['ALISTADA'],                                 hacia: 'DESPACHADA',      fecha: 'fecha_despacho' },
  cancelar:  { desde: ['CREADA', 'APROBADA', 'EN_ALISTAMIENTO', 'ALISTADA'], hacia: 'CANCELADA', fecha: 'fecha_cancelacion' }
};

// Devuelve la transición si es válida, o un mensaje de error si no lo es
function validarTransicion(estadoActual, accion) {
  const transicion = TRANSICIONES[accion];
  if (!transicion) {
    return { error: `Acción desconocida: ${accion}` };
  }
  if (!transicion.desde.includes(estadoActual)) {
    return { error: `No se puede "${accion}" una solicitud en estado ${estadoActual}.` };
  }
  return { transicion };
}

// Acciones disponibles para un estado (útil para pintar botones en el frontend)
function accionesDisponibles(estado) {
  return Object.keys(TRANSICIONES).filter(accion => TRANSICIONES[accion].desde.includes(estado));
}

module.exports = { TRANSICIONES, validarTransicion, accionesDisponibles };
