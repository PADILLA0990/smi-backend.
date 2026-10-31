// Registra un movimiento en el historial con el usuario autenticado (nunca con un nombre enviado por el navegador).
// documentoId: documento de ingreso o salida al que pertenece (Fase D2), si lo hay.
const registrarHistorial = (tx, codigo_producto, accion, usuario, detalles, documentoId = null) =>
  tx.historial.create({ data: { codigo_producto, accion, operario: usuario.usuario, usuarioId: usuario.id, detalles, documentoId } });

module.exports = { registrarHistorial };
