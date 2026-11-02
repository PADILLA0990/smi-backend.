// Ingresos y retiros de stock (Fase D2). Lo usan las rutas sueltas (POST /productos, POST /salida)
// y los documentos de varias líneas (documentos/routes.js). Todo se ejecuta dentro de la transacción tx.
// El detalle del historial conserva el formato que lee el verificador ("Ingresó cantidad: N", "Retiro de N").
const { StockError, descontarStock } = require('./stock');
const { CONDICIONES, GRUPOS, resolverActivo } = require('./catalogos');
const { registrarHistorial } = require('./historial');
const { validarCodificacion } = require('./codificacion');

// Atributos opcionales del producto (Fase C). Devuelve solo los campos enviados, ya validados.
function validarAtributos(body) {
  const data = {};
  if ('talla' in body) {
    const talla = typeof body.talla === 'string' ? body.talla.trim() : '';
    if (talla.length > 20) throw new StockError(400, 'Talla: máximo 20 caracteres.');
    data.talla = talla || null;
  }
  if ('condicion' in body) {
    if (body.condicion && !Object.hasOwn(CONDICIONES, body.condicion)) throw new StockError(400, 'Condición no válida.');
    data.condicion = body.condicion || null;
  }
  if ('grupo' in body) {
    if (body.grupo && !GRUPOS.includes(body.grupo)) throw new StockError(400, 'Género o grupo etario no válido.');
    data.grupo = body.grupo || null;
  }
  if ('stock_minimo' in body) {
    const vacio = body.stock_minimo === null || body.stock_minimo === '';
    const n = Number(body.stock_minimo);
    if (!vacio && (!Number.isInteger(n) || n < 0 || n > 100000)) throw new StockError(400, 'Stock mínimo: número entero entre 0 y 100.000.');
    data.stock_minimo = vacio ? null : n;
  }
  return data;
}

// La categoría llega como id (categoriaId) o por nombre (categoria); debe estar activa en el catálogo
const resolverCategoria = (tx, body) =>
  resolverActivo(tx, 'categoria', body.categoriaId ?? body.categoria, { etiqueta: 'La categoría' });

// Una ubicación del catálogo, por su código
const resolverUbicacion = (tx, codigo) =>
  resolverActivo(tx, 'ubicacion', codigo, { campoTexto: 'codigo', etiqueta: 'La ubicación' });

// Unidad de manejo del catálogo; sin unidad se cuenta en unidades sueltas
async function resolverUnidad(tx, valor) {
  if (valor === undefined || valor === null || valor === '') return { nombre: 'Unidad', factor: 1 };
  return resolverActivo(tx, 'unidadManejo', valor, { etiqueta: 'La unidad de manejo' });
}

// "(2 Caja × 20)" cuando la unidad de manejo agrupa varias unidades
const desglose = (cantidadManejo, unidad) => (unidad.factor > 1 ? ` (${cantidadManejo} ${unidad.nombre} × ${unidad.factor})` : '');
const sufijoDocumento = (documento) => (documento ? `. Documento ${documento.numero}` : '');

// Producto nuevo con su ingreso inicial. datos: { codigo_producto, descripcion, categoriaId | categoria, ubicacion_general, atributos }
async function crearProducto(tx, datos, cantidad, usuario, { documento, detalleCantidad = '' } = {}) {
  if (datos.categoriaId === undefined && (typeof datos.categoria !== 'string' || !datos.categoria.trim())) {
    throw new StockError(400, 'El campo "categoria" es obligatorio.');
  }
  const atributos = validarAtributos(datos);
  const categoria = await resolverCategoria(tx, datos);
  // Categorías con letra: el código sigue la codificación 001-RCM-B y se guardan subcategoría y variante
  const niveles = await validarCodificacion(tx, categoria, { ...datos, condicion: atributos.condicion }, datos.codigo_producto);
  const ubicacion = await resolverUbicacion(tx, datos.ubicacion_general || 'Recepción');
  const producto = await tx.producto.create({
    data: {
      codigo_producto: datos.codigo_producto, descripcion: datos.descripcion, cantidad, ...atributos, ...niveles,
      categoria: categoria.nombre,
      categoriaId: categoria.id,
      // "estado" (texto) se conserva por compatibilidad y refleja la condición
      estado: atributos.condicion ? CONDICIONES[atributos.condicion] : (datos.estado || 'Bueno'),
      ubicacion_general: ubicacion.codigo
    }
  });
  // La ubicación inicial va al final del detalle para que el verificador la lea (si no es Recepción)
  const inicial = ubicacion.codigo === 'Recepción' ? '' : `. Ubicación inicial: ${ubicacion.codigo}`;
  await registrarHistorial(tx, producto.codigo_producto, 'INGRESO NUEVO', usuario,
    `Ingresó cantidad: ${cantidad}${detalleCantidad}${sufijoDocumento(documento)}${inicial}`, documento?.id);
  return producto;
}

// Suma unidades a un producto existente y activo
async function sumarStock(tx, existente, cantidad, usuario, { documento, detalleCantidad = '' } = {}) {
  if (!existente.activo) throw new StockError(409, `El producto ${existente.codigo_producto} está inactivo. Actívelo antes de registrar ingresos.`);
  const producto = await tx.producto.update({ where: { id: existente.id }, data: { cantidad: { increment: cantidad } } });
  await registrarHistorial(tx, existente.codigo_producto, 'INGRESO ADICIONAL', usuario,
    `Ingresó cantidad: ${cantidad}${detalleCantidad}. Stock total: ${producto.cantidad}${sufijoDocumento(documento)}`, documento?.id);
  return producto;
}

// Retira unidades libres (no reservadas por SBO). detalle: texto tras el motivo (". Detalle: …", ". Destino: …")
async function retirarStock(tx, codigo_producto, cantidad, usuario, { motivo, detalle = '', documento, detalleCantidad = '' }) {
  const restante = await descontarStock(tx, codigo_producto, cantidad);
  await registrarHistorial(tx, codigo_producto, 'SALIDA/RETIRO', usuario,
    `Retiro de ${cantidad} unidades${detalleCantidad}. Motivo: ${motivo.nombre}${detalle}${sufijoDocumento(documento)}`, documento?.id);
  return restante;
}

module.exports = {
  validarAtributos, resolverCategoria, resolverUbicacion, resolverUnidad, desglose,
  crearProducto, sumarStock, retirarStock
};
