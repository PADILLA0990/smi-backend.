// Registra un movimiento en el historial con el usuario autenticado (nunca con un nombre enviado por el navegador)
const registrarHistorial = (tx, codigo_producto, accion, usuario, detalles) =>
  tx.historial.create({ data: { codigo_producto, accion, operario: usuario.usuario, usuarioId: usuario.id, detalles } });

module.exports = { registrarHistorial };
