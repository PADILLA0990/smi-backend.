// Registra un movimiento en el historial con el usuario autenticado (nunca con un nombre enviado por el navegador).
// documentoId: documento de ingreso o salida al que pertenece (Fase D2), si lo hay.
const registrarHistorial = (tx, codigo_producto, accion, usuario, detalles, documentoId = null) =>
  tx.historial.create({ data: { codigo_producto, accion, operario: usuario.usuario, usuarioId: usuario.id, detalles, documentoId } });

// Cambios en Configuración: quedan en el historial con su responsable, pero no son movimientos de inventario.
// En "codigo_producto" va el área ("Organización", "Parámetros"…).
const ACCION_CONFIGURACION = 'CONFIGURACIÓN';
const registrarConfiguracion = (tx, area, usuario, detalles) =>
  registrarHistorial(tx, area, ACCION_CONFIGURACION, usuario, detalles);

const valorLegible = (v) => {
  if (v === null || v === undefined || v === '') return 'vacío';
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  return String(v);
};

// "Campo: antes → después" de cada campo que cambió, separados por coma. Vacío si nada cambió.
const describirCambios = (antes, despues, etiquetas) =>
  Object.entries(etiquetas)
    .filter(([campo]) => valorLegible(antes[campo]) !== valorLegible(despues[campo]))
    .map(([campo, etiqueta]) => `${etiqueta}: ${valorLegible(antes[campo])} → ${valorLegible(despues[campo])}`)
    .join(', ');

// Edición de un registro de Configuración. Guardar sin cambios reales no deja registro.
async function registrarEdicion(tx, area, usuario, nombre, antes, despues, etiquetas) {
  const cambioEstado = 'activo' in despues && antes.activo !== despues.activo;
  const cambios = describirCambios(antes, despues, etiquetas);
  if (!cambioEstado && !cambios) return;
  const verbo = cambioEstado ? (despues.activo ? 'Activó' : 'Desactivó') : 'Editó';
  await registrarConfiguracion(tx, area, usuario, `${verbo} ${nombre}${cambios ? `: ${cambios}` : ''}`);
}

module.exports = { registrarHistorial, ACCION_CONFIGURACION, registrarConfiguracion, describirCambios, registrarEdicion };
