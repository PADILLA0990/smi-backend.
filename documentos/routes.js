// Documentos de ingreso y salida (Fase D2): varias líneas registradas en una sola transacción.
// Si una línea falla no se guarda nada. Cada línea deja su movimiento en el historial enlazado al documento.
const express = require('express');
const prisma = require('../lib/prisma');
const { StockError } = require('../lib/stock');
const { manejarError, esEnteroPositivo } = require('../lib/errores');
const { autorizar } = require('../auth/middleware');
const { CONDICIONES, resolverActivo } = require('../lib/catalogos');
const { leerPaginacion, filtroFechas } = require('../lib/inventario');
const { resolverUnidad, desglose, crearProducto, sumarStock, retirarStock } = require('../lib/movimientos');

const router = express.Router();

const ORIGENES = { DONACION: 'Donación', COMPRA: 'Compra' };
const PREFIJOS = { INGRESO: 'ING', SALIDA: 'SAL' };
// Llaves del bloqueo que serializa la numeración de cada tipo (pg_advisory_xact_lock)
const LLAVES_CONSECUTIVO = { INGRESO: 4201, SALIDA: 4202 };
// Tipo de tercero aceptado según el origen del ingreso
const TERCEROS_DE = { DONACION: ['DONANTE', 'AMBOS'], COMPRA: ['PROVEEDOR', 'AMBOS'] };
const MAX_LINEAS = 100;
const MAX_CANTIDAD = 100000;
// Un documento de muchas líneas contra la base remota puede tardar; si se pasa, no queda nada guardado
const OPCIONES_TX = { maxWait: 10000, timeout: 60000 };

const texto = (v) => (typeof v === 'string' ? v.trim() : '');

function textoOpcional(valor, max, etiqueta) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new StockError(400, `${etiqueta}: debe ser texto.`);
  const t = valor.trim();
  if (t.length > max) throw new StockError(400, `${etiqueta}: máximo ${max} caracteres.`);
  return t || null;
}

// Valida las líneas sin tocar la base. En las salidas no se aceptan productos nuevos.
function leerLineas(lineas, { ingreso }) {
  if (!Array.isArray(lineas) || lineas.length === 0) throw new StockError(400, 'El documento debe tener al menos una línea.');
  if (lineas.length > MAX_LINEAS) throw new StockError(400, `Un documento admite máximo ${MAX_LINEAS} líneas.`);
  const vistos = new Set();
  return lineas.map((l, i) => {
    const n = i + 1;
    const codigo_producto = texto(l?.codigo_producto);
    if (!codigo_producto || codigo_producto.length > 40) throw new StockError(400, `Línea ${n}: el código del producto es obligatorio (máximo 40 caracteres).`);
    const clave = codigo_producto.toLowerCase();
    if (vistos.has(clave)) throw new StockError(400, `Línea ${n}: ${codigo_producto} está repetido. Sume las cantidades en una sola línea.`);
    vistos.add(clave);
    const cantidad = Number(l.cantidad);
    if (!esEnteroPositivo(cantidad) || cantidad > MAX_CANTIDAD) throw new StockError(400, `Línea ${n}: la cantidad debe ser un número entero entre 1 y ${MAX_CANTIDAD.toLocaleString('es-CO')}.`);
    const linea = { n, codigo_producto, cantidad, unidadId: l.unidadId };
    if (ingreso && 'condicion' in l) {
      if (l.condicion && !Object.hasOwn(CONDICIONES, l.condicion)) throw new StockError(400, `Línea ${n}: condición no válida.`);
      linea.condicion = l.condicion || null;
    }
    if (ingreso && l.nuevo) {
      const descripcion = texto(l.nuevo.descripcion);
      if (!descripcion || descripcion.length > 200) throw new StockError(400, `Línea ${n}: la descripción del producto nuevo es obligatoria (máximo 200 caracteres).`);
      linea.nuevo = { ...l.nuevo, descripcion };
    }
    return linea;
  });
}

// Antepone la línea al mensaje de un error de negocio ("Línea 2 (ROP-005): …")
async function enLinea(linea, fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StockError && !error.message.startsWith('Línea ')) error.message = `Línea ${linea.n} (${linea.codigo_producto}): ${error.message}`;
    throw error;
  }
}

// Siguiente número del tipo (ING-0001…). El bloqueo dura hasta el fin de la transacción:
// dos documentos simultáneos nunca reciben el mismo consecutivo.
async function siguienteNumero(tx, tipo) {
  await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${LLAVES_CONSECUTIVO[tipo]})::text`);
  const { _max } = await tx.documento.aggregate({ where: { tipo }, _max: { consecutivo: true } });
  const consecutivo = (_max.consecutivo || 0) + 1;
  return { consecutivo, numero: `${PREFIJOS[tipo]}-${String(consecutivo).padStart(4, '0')}` };
}

const crearDocumento = async (tx, tipo, datos, usuario) => tx.documento.create({
  data: { tipo, ...(await siguienteNumero(tx, tipo)), ...datos, operario: usuario.usuario, usuarioId: usuario.id }
});

const leerDocumento = (db, where) => db.documento.findUnique({ where, include: { lineas: { orderBy: { id: 'asc' } } } });

// Ingreso: { origen, terceroId?, soporte?, observaciones?, lineas: [{ codigo_producto, cantidad, unidadId?, condicion?, nuevo? }] }
// "nuevo" crea el producto ({ descripcion, categoriaId, condicion, talla, grupo, stock_minimo, ubicacion_general }).
// Cada condición tiene su propio código: si "condicion" no coincide con la del producto existente, se rechaza.
router.post('/documentos/ingreso', autorizar('movimientos:registrar'), async (req, res) => {
  try {
    const body = req.body || {};
    if (!Object.hasOwn(ORIGENES, body.origen)) throw new StockError(400, 'Indique el origen del ingreso: Donación o Compra.');
    const soporte = textoOpcional(body.soporte, 60, 'El documento soporte');
    const observaciones = textoOpcional(body.observaciones, 500, 'Las observaciones');
    const lineas = leerLineas(body.lineas, { ingreso: true });

    const id = await prisma.$transaction(async (tx) => {
      let tercero = null;
      if (body.terceroId !== undefined && body.terceroId !== null && body.terceroId !== '') {
        const etiqueta = body.origen === 'COMPRA' ? 'El proveedor' : 'El donante';
        tercero = await resolverActivo(tx, 'tercero', body.terceroId, { etiqueta });
        if (!TERCEROS_DE[body.origen].includes(tercero.tipo)) {
          throw new StockError(400, `${tercero.nombre} no está registrado como ${body.origen === 'COMPRA' ? 'proveedor' : 'donante'}.`);
        }
      }
      const documento = await crearDocumento(tx, 'INGRESO', {
        origen: body.origen, terceroId: tercero?.id ?? null, tercero_nombre: tercero?.nombre ?? null, soporte, observaciones
      }, req.usuario);

      const filas = [];
      for (const linea of lineas) {
        filas.push(await enLinea(linea, async () => {
          const unidad = await resolverUnidad(tx, linea.unidadId);
          const cantidad = linea.cantidad * unidad.factor;
          const opciones = { documento, detalleCantidad: desglose(linea.cantidad, unidad) };
          const existente = await tx.producto.findUnique({ where: { codigo_producto: linea.codigo_producto } });
          let producto;
          if (linea.nuevo) {
            if (existente) throw new StockError(409, 'ese código ya existe. Elíjalo de la lista en lugar de crearlo.');
            producto = await crearProducto(tx, { ...linea.nuevo, codigo_producto: linea.codigo_producto }, cantidad, req.usuario, opciones);
          } else {
            if (!existente) throw new StockError(404, 'el producto no existe. Regístrelo como producto nuevo.');
            if ('condicion' in linea && linea.condicion !== existente.condicion) {
              const actual = existente.condicion ? CONDICIONES[existente.condicion] : 'sin condición';
              const llega = linea.condicion ? CONDICIONES[linea.condicion] : 'sin condición';
              throw new StockError(409, `está registrado como "${actual}" y llega "${llega}". Cada condición tiene su propio código: registre un producto nuevo para estas unidades.`);
            }
            producto = await sumarStock(tx, existente, cantidad, req.usuario, opciones);
          }
          return {
            documentoId: documento.id, codigo_producto: producto.codigo_producto, descripcion: producto.descripcion,
            condicion: producto.condicion, unidad: unidad.nombre, factor: unidad.factor,
            cantidad_manejo: linea.cantidad, cantidad, producto_nuevo: !!linea.nuevo
          };
        }));
      }
      await tx.documentoLinea.createMany({ data: filas });
      return documento.id;
    }, OPCIONES_TX);

    res.status(201).json(await leerDocumento(prisma, { id }));
  } catch (error) {
    manejarError(res, error, 'Error al registrar el documento de ingreso');
  }
});

// Salida: { motivoId, organizacionId?, observaciones?, lineas: [{ codigo_producto, cantidad, unidadId? }] }
// Solo se retira stock libre (lo reservado por SBO no). Los productos inactivos sí se pueden retirar.
router.post('/documentos/salida', autorizar('movimientos:registrar'), async (req, res) => {
  try {
    const body = req.body || {};
    const motivoEnviado = body.motivoId ?? body.motivo;
    if (motivoEnviado === undefined || motivoEnviado === null || String(motivoEnviado).trim() === '') {
      throw new StockError(400, 'El motivo de la salida es obligatorio.');
    }
    const observaciones = textoOpcional(body.observaciones, 500, 'Las observaciones');
    const lineas = leerLineas(body.lineas, { ingreso: false });

    const id = await prisma.$transaction(async (tx) => {
      const motivo = await resolverActivo(tx, 'motivo', motivoEnviado, { extra: { tipo: 'SALIDA' }, etiqueta: 'El motivo de salida' });
      const organizacion = body.organizacionId
        ? await resolverActivo(tx, 'organizacion', body.organizacionId, { etiqueta: 'La organización destino' })
        : null;
      const documento = await crearDocumento(tx, 'SALIDA', {
        motivoId: motivo.id, motivo_nombre: motivo.nombre,
        organizacionId: organizacion?.id ?? null, organizacion_nombre: organizacion?.nombre ?? null, observaciones
      }, req.usuario);

      const filas = [];
      for (const linea of lineas) {
        filas.push(await enLinea(linea, async () => {
          const unidad = await resolverUnidad(tx, linea.unidadId);
          const cantidad = linea.cantidad * unidad.factor;
          await retirarStock(tx, linea.codigo_producto, cantidad, req.usuario, {
            motivo, documento, detalleCantidad: desglose(linea.cantidad, unidad),
            detalle: organizacion ? `. Destino: ${organizacion.nombre}` : ''
          });
          const producto = await tx.producto.findUnique({ where: { codigo_producto: linea.codigo_producto } });
          return {
            documentoId: documento.id, codigo_producto: producto.codigo_producto, descripcion: producto.descripcion,
            condicion: producto.condicion, unidad: unidad.nombre, factor: unidad.factor,
            cantidad_manejo: linea.cantidad, cantidad, producto_nuevo: false
          };
        }));
      }
      await tx.documentoLinea.createMany({ data: filas });
      return documento.id;
    }, OPCIONES_TX);

    res.status(201).json(await leerDocumento(prisma, { id }));
  } catch (error) {
    manejarError(res, error, 'Error al registrar el documento de salida');
  }
});

// Lista paginada: ?pagina=&porPagina=&tipo=INGRESO|SALIDA&desde=&hasta=&q= (número, tercero, organización, soporte o código)
router.get('/documentos', autorizar('inventario:ver'), async (req, res) => {
  try {
    const { pagina, porPagina } = leerPaginacion(req.query, 25);
    const and = filtroFechas(req.query);
    if (req.query.tipo) {
      if (!Object.hasOwn(PREFIJOS, req.query.tipo)) throw new StockError(400, 'Tipo de documento no válido.');
      and.push({ tipo: req.query.tipo });
    }
    const q = texto(req.query.q);
    if (q) {
      const contiene = { contains: q, mode: 'insensitive' };
      and.push({
        OR: [
          ...['numero', 'tercero_nombre', 'organizacion_nombre', 'soporte', 'operario'].map(c => ({ [c]: contiene })),
          { lineas: { some: { codigo_producto: contiene } } }
        ]
      });
    }
    const where = { AND: and };
    const [total, documentos] = await Promise.all([
      prisma.documento.count({ where }),
      prisma.documento.findMany({
        where, orderBy: [{ fecha: 'desc' }, { id: 'desc' }], skip: (pagina - 1) * porPagina, take: porPagina,
        include: { lineas: { select: { cantidad: true } } }
      })
    ]);
    res.json({
      datos: documentos.map(({ lineas, ...d }) => ({ ...d, lineas: lineas.length, unidades: lineas.reduce((s, l) => s + l.cantidad, 0) })),
      total, pagina, porPagina
    });
  } catch (error) {
    manejarError(res, error, 'Error al consultar los documentos');
  }
});

// Un documento con sus líneas, por id o por número (ING-0001)
router.get('/documentos/:ref', autorizar('inventario:ver'), async (req, res) => {
  try {
    const ref = req.params.ref;
    const where = /^\d{1,9}$/.test(ref) ? { id: Number(ref) } : { numero: ref.toUpperCase() };
    const documento = await leerDocumento(prisma, where);
    if (!documento) throw new StockError(404, 'El documento no existe.');
    res.json(documento);
  } catch (error) {
    manejarError(res, error, 'Error al consultar el documento');
  }
});

module.exports = router;
