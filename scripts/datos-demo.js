// Datos ficticios para probar todas las pantallas: organizaciones, donantes, productos, ingresos, salidas,
// SBO en cada estado, novedades, devoluciones, conteos y huecos llenos. Todo lleva la marca DEMO y se puede borrar.
//
// Uso (sin --aplicar solo muestra qué haría):
//   node --env-file=.env.pruebas scripts/datos-demo.js cargar --aplicar
//   node --env-file=.env.pruebas scripts/datos-demo.js borrar --aplicar
// Contra otra base distinta de smi_pruebas exige además --produccion.
//
// Cada comando es una sola transacción: si algo falla no queda nada a medias.
// Usa las mismas funciones del programa (lib/) y deja el historial que espera el verificador de consistencia.
if (!process.env.DATABASE_URL) require('dotenv').config();

const prisma = require('../lib/prisma');
const { reservarStock, liberarReserva, despacharReservado } = require('../lib/stock');
const { registrarHistorial } = require('../lib/historial');
const { resolverUbicacion, desglose, crearProducto, sumarStock, retirarStock } = require('../lib/movimientos');
const { siguienteCodigo: siguienteCodigoProducto } = require('../lib/codificacion');
const { siguienteCodigo: siguienteCodigoSbo, ESTADOS_CON_RESERVA } = require('../lib/solicitudes');
const { registrarNovedad, sustituirItem, devolverItem, registrarFaltantes } = require('../lib/novedades');
const { registrarConteo, aprobarConteo } = require('../lib/conciliacion');
const { marcarHuecoLleno } = require('../lib/estanterias');
const { validarTransicion } = require('../solicitudes/estados');

const MARCA = 'DEMO · ';
const NOMBRE_DEMO = 'DEMO ';
const PERSONAS = ['DEMO-Laura', 'DEMO-Andres', 'DEMO-Marcela'].map(usuario => ({ id: null, usuario }));
const SISTEMA = { id: null, usuario: 'DEMO-sistema' };
const persona = (i) => PERSONAS[i % PERSONAS.length];
const DIA = 24 * 60 * 60 * 1000;
const hace = (dias) => new Date(Date.now() - dias * DIA);

const ORGANIZACIONES = [
  ['Fundación Semillas de Esperanza', '900000101-1', 'Usaquén'], ['Hogar Comunitario Rayito de Sol', '900000102-2', 'Kennedy'],
  ['Comedor Barrial La Esperanza', '900000103-3', 'Ciudad Bolívar'], ['Asociación Manos Unidas', '900000104-4', 'Bosa'],
  ['Parroquia San José Obrero', '900000105-5', 'Suba'], ['Corporación Nuevo Amanecer', '900000106-6', 'Engativá'],
  ['Red de Madres Comunitarias', '900000107-7', 'San Cristóbal'], ['Albergue Puerta Abierta', '900000108-8', 'Santa Fe']
];
const TERCEROS = [
  ['DONANTE', 'Textiles La Sabana S.A.S.', '900000201-1'], ['DONANTE', 'Supermercados El Ahorro', '900000202-2'],
  ['DONANTE', 'Fundación Empresarial Andina', '900000203-3'], ['PROVEEDOR', 'Distribuidora Aseo Total', '900000204-4'],
  ['PROVEEDOR', 'Papelería Mayorista Central', '900000205-5'], ['AMBOS', 'Comercializadora del Hogar', '900000206-6']
];

// k: clave · l: letras [categoría, subcategoría, variante] · f: categoría sin codificación (bases sin el árbol)
// n: cantidad en unidad de manejo · caja: entra por cajas · a: área fija · r: queda en Recepción (sin ubicar) · min: stock mínimo
const ARTICULOS = [
  [{ k: 'camiseta', l: 'RCH', f: 'Textiles', d: 'Camiseta de algodón', c: 'BUENO', t: 'M', g: 'Hombre', n: 240, min: 30 }, { k: 'pantalon', l: 'RPM', f: 'Textiles', d: 'Pantalón jean', c: 'PERFECTO', t: '32', g: 'Mujer', n: 160, min: 20 }, { k: 'chaqueta', l: 'RAU', f: 'Textiles', d: 'Chaqueta impermeable', c: 'BUENO', t: 'L', g: 'Unisex', n: 90 }, { k: 'medias', l: 'RIU', f: 'Textiles', d: 'Medias deportivas', c: 'PERFECTO', t: 'Única', g: 'Unisex', n: 18, caja: true, min: 40 }, { k: 'zapato', l: 'ZZH', f: 'Calzado', d: 'Zapato de cuero', c: 'BUENO', t: '40', g: 'Hombre', n: 120, min: 15 }, { k: 'tenis', l: 'ZTN', f: 'Calzado', d: 'Tenis escolares', c: 'DETERIORO', t: '34', g: 'Niño', n: 70 }],
  [{ k: 'cobija', l: 'TCD', f: 'Textiles', d: 'Cobija térmica doble', c: 'PERFECTO', n: 150, min: 25 }, { k: 'sabana', l: 'TSS', f: 'Textiles', d: 'Juego de sábanas sencillo', c: 'BUENO', n: 110 }, { k: 'toalla', l: 'TTU', f: 'Textiles', d: 'Toalla de baño', c: 'BUENO', n: 130 }, { k: 'jabon', l: 'HJP', f: 'Aseo no perecedero', d: 'Jabón de tocador', c: 'PERFECTO', n: 24, caja: true, min: 60 }, { k: 'champu', l: 'HCI', f: 'Aseo no perecedero', d: 'Champú 400 ml', c: 'PERFECTO', n: 95 }, { k: 'crema', l: 'HDI', f: 'Aseo no perecedero', d: 'Crema dental', c: 'PERFECTO', n: 6, r: true, min: 12 }],
  [{ k: 'panal', l: 'BPM', f: 'Otros', d: 'Pañales etapa mediana', c: 'PERFECTO', n: 12, caja: true, min: 80 }, { k: 'toallitas', l: 'BTU', f: 'Otros', d: 'Toallitas húmedas', c: 'PERFECTO', n: 85 }, { k: 'detergente', l: 'ADP', f: 'Aseo no perecedero', d: 'Detergente en polvo', c: 'PERFECTO', n: 100, min: 20 }, { k: 'limpiador', l: 'ALI', f: 'Aseo no perecedero', d: 'Limpiador multiusos', c: 'BUENO', n: 75 }, { k: 'papel', l: 'APP', f: 'Aseo no perecedero', d: 'Servilletas de papel', c: 'PERFECTO', n: 8, min: 15 }, { k: 'bolsas', l: 'ABG', f: 'Aseo no perecedero', d: 'Bolsas de basura', c: 'PERFECTO', n: 60 }],
  [{ k: 'olla', l: 'COM', f: 'Hogar', d: 'Olla de aluminio', c: 'BUENO', n: 45 }, { k: 'vajilla', l: 'CVV', f: 'Hogar', d: 'Juego de platos', c: 'DETERIORO', n: 35 }, { k: 'cubiertos', l: 'CCM', f: 'Hogar', d: 'Juego de cubiertos', c: 'PERFECTO', n: 55 }, { k: 'silla', l: 'MSP', f: 'Hogar', d: 'Silla plástica', c: 'BUENO', n: 40, r: true }, { k: 'mesa', l: 'MMM', f: 'Hogar', d: 'Mesa de madera', c: 'DETERIORO', n: 12, a: 'Almacenamiento a piso' }, { k: 'colchon', l: 'MCX', f: 'Hogar', d: 'Colchón sencillo', c: 'DANADO', n: 9, a: 'Exhibición de muebles' }],
  [{ k: 'cuaderno', l: 'ECN', f: 'Papelería', d: 'Cuaderno argollado', c: 'PERFECTO', n: 10, caja: true, min: 50 }, { k: 'lapices', l: 'EUU', f: 'Papelería', d: 'Caja de lápices', c: 'PERFECTO', n: 80 }, { k: 'morral', l: 'EMJ', f: 'Papelería', d: 'Morral escolar', c: 'BUENO', n: 50 }, { k: 'juguete', l: 'JJN', f: 'Juguetes', d: 'Carro de juguete', c: 'BUENO', n: 65, a: 'Cajas' }, { k: 'juegomesa', l: 'JMU', f: 'Juguetes', d: 'Parqués', c: 'PERFECTO', n: 30 }, { k: 'balon', l: 'JDJ', f: 'Juguetes', d: 'Balón de fútbol', c: 'DETERIORO', n: 25 }],
  [{ k: 'kitaseo', l: 'KAF', f: 'Otros', d: 'Kit de aseo familiar', c: 'PERFECTO', n: 70, r: true }, { k: 'kitcocina', l: 'KCF', f: 'Otros', d: 'Kit de cocina', c: 'PERFECTO', n: 28 }, { k: 'linterna', l: 'KLI', f: 'Otros', d: 'Linterna recargable', c: 'BUENO', n: 45 }, { k: 'hamaca', l: 'KHI', f: 'Otros', d: 'Hamaca', c: 'BUENO', n: 20 }, { k: 'variado', l: 'OOU', f: 'Otros', d: 'Artículos varios', c: 'DANADO', n: 15, r: true }, { k: 'lampara', l: 'CEE', f: 'Hogar', d: 'Lámpara de mesa', c: 'BUENO', n: 10 }]
];
const DIAS_INGRESO = [150, 120, 90, 60, 30, 10];

// Historial y novedades se crean con la fecha de hoy: esto los lleva a la fecha simulada
const marcar = async (tx) => ({
  h: (await tx.historial.aggregate({ _max: { id: true } }))._max.id || 0,
  n: (await tx.novedad.aggregate({ _max: { id: true } }))._max.id || 0
});
async function fechar(tx, marca, fecha) {
  await tx.historial.updateMany({ where: { id: { gt: marca.h }, operario: { startsWith: 'DEMO-' } }, data: { fecha } });
  await tx.novedad.updateMany({ where: { id: { gt: marca.n }, usuario: { startsWith: 'DEMO-' } }, data: { fecha } });
}

async function nuevoDocumento(tx, tipo, dias, datos, autor) {
  const { _max } = await tx.documento.aggregate({ where: { tipo }, _max: { consecutivo: true } });
  const consecutivo = (_max.consecutivo || 0) + 1;
  const numero = `${tipo === 'INGRESO' ? 'ING' : 'SAL'}-${String(consecutivo).padStart(4, '0')}`;
  return tx.documento.create({ data: { tipo, consecutivo, numero, fecha: hace(dias), operario: autor.usuario, usuarioId: null, ...datos } });
}

const lineaDe = (documento, producto, unidad, manejo, nuevo) => ({
  documentoId: documento.id, codigo_producto: producto.codigo_producto, descripcion: producto.descripcion, condicion: producto.condicion,
  unidad: unidad.nombre, factor: unidad.factor, cantidad_manejo: manejo, cantidad: manejo * unidad.factor, producto_nuevo: nuevo
});

// Categoría del árbol (por letra) o, en una base sin árbol, la que corresponda por nombre
function nivelesDe(articulo, categorias) {
  const [letra, letraSub, letraVar] = articulo.l;
  const activas = categorias.filter(c => c.activo);
  const categoria = activas.find(c => c.letra === letra) || activas.find(c => c.nombre === articulo.f) || activas[0];
  if (!categoria.letra) return { categoria };
  const sub = categoria.subcategorias.find(s => s.letra === letraSub && s.activo) || categoria.subcategorias.find(s => s.activo);
  const variante = categoria.variantes.find(v => v.letra === letraVar && v.activo) || categoria.variantes.find(v => v.activo);
  return { categoria, sub, variante };
}

async function asegurarCatalogos(tx) {
  const motivos = {};
  const nombres = { SALIDA: 'Merma', AJUSTE: 'Diferencia de conteo', NOVEDAD: 'Empaque averiado' };
  for (const tipo of Object.keys(nombres)) {
    motivos[tipo] = await tx.motivo.findFirst({ where: { tipo, activo: true } })
      || await tx.motivo.create({ data: { tipo, nombre: NOMBRE_DEMO + nombres[tipo] } });
  }
  const caja = await tx.unidadManejo.findFirst({ where: { activo: true, factor: { gte: 10 }, nombre: { not: { startsWith: 'TEST-' } } }, orderBy: { factor: 'asc' } })
    || await tx.unidadManejo.create({ data: { nombre: `${NOMBRE_DEMO}Caja`, factor: 12 } });
  const organizaciones = [];
  for (const [nombre, nit, localidad] of ORGANIZACIONES) {
    organizaciones.push(await tx.organizacion.create({ data: { nombre: NOMBRE_DEMO + nombre, nit, localidad, contacto: 'Persona de contacto ficticia', telefono: '3000000000', correo: 'contacto@ejemplo.org', direccion: 'Dirección ficticia' } }));
  }
  const terceros = [];
  for (const [tipo, nombre, nit] of TERCEROS) {
    terceros.push(await tx.tercero.create({ data: { tipo, nombre: NOMBRE_DEMO + nombre, nit, contacto: 'Persona de contacto ficticia', telefono: '3000000000', correo: 'contacto@ejemplo.org' } }));
  }
  return { motivos, caja, organizaciones, terceros };
}

// Huecos activos vacíos, repartidos a lo largo de la bodega
async function huecosLibres(tx, cuantos) {
  const huecos = await tx.ubicacion.findMany({ where: { activo: true, estanteriaId: { not: null } }, orderBy: { codigo: 'asc' } });
  const usados = new Set((await tx.producto.findMany({ where: { cantidad: { gt: 0 } }, select: { codigo_estanteria: true, ubicacion_general: true } })).map(p => (p.codigo_estanteria || p.ubicacion_general).toUpperCase()));
  const libres = huecos.filter(u => !usados.has(u.codigo.toUpperCase()));
  if (libres.length < cuantos) throw new Error(`Se necesitan ${cuantos} huecos libres y hay ${libres.length}.`);
  const paso = Math.max(1, Math.floor(libres.length / cuantos));
  return Array.from({ length: cuantos }, (_, i) => libres[i * paso].codigo);
}

async function cargarIngresos(tx, cat) {
  const categorias = await tx.categoria.findMany({ include: { subcategorias: true, variantes: true } });
  const areas = new Set((await tx.ubicacion.findMany({ where: { activo: true, estanteriaId: null }, select: { codigo: true } })).map(u => u.codigo));
  const conHueco = ARTICULOS.flat().filter(a => !a.r && !(a.a && areas.has(a.a))).length;
  const huecos = await huecosLibres(tx, conHueco + 1);
  const productos = {};
  let consecutivoLibre = 0, siguienteHueco = 0;

  for (const [lote, articulos] of ARTICULOS.entries()) {
    const compra = lote === 2;
    const tercero = compra ? cat.terceros[3] : cat.terceros[[0, 1, 0, 5, 2, 2][lote]];
    const autor = persona(lote);
    const marca = await marcar(tx);
    const documento = await nuevoDocumento(tx, 'INGRESO', DIAS_INGRESO[lote], {
      origen: compra ? 'COMPRA' : 'DONACION', terceroId: tercero.id, tercero_nombre: tercero.nombre,
      soporte: `DEMO-${compra ? 'FAC' : 'REM'}-${String(lote + 1).padStart(3, '0')}`, observaciones: 'DEMO: ingreso de ejemplo'
    }, autor);
    const filas = [];
    for (const a of articulos) {
      const { categoria, sub, variante } = nivelesDe(a, categorias);
      const codigo_producto = categoria.letra
        ? (await siguienteCodigoProducto(tx, { categoriaId: categoria.id, subcategoriaId: sub.id, varianteId: variante.id, condicion: a.c })).codigo
        : `DEMO-${String(++consecutivoLibre).padStart(3, '0')}`;
      const unidad = a.caja ? cat.caja : { nombre: 'Unidad', factor: 1 };
      const ubicacion_general = a.r ? 'Recepción' : (a.a && areas.has(a.a)) ? a.a : huecos[siguienteHueco++];
      const producto = await crearProducto(tx, {
        codigo_producto, descripcion: MARCA + a.d, categoriaId: categoria.id, condicion: a.c, talla: a.t, grupo: a.g, stock_minimo: a.min ?? null,
        ubicacion_general, ...(sub ? { subcategoriaId: sub.id, varianteId: variante.id } : {})
      }, a.n * unidad.factor, autor, { documento, detalleCantidad: desglose(a.n, unidad) });
      productos[a.k] = producto;
      filas.push(lineaDe(documento, producto, unidad, a.n, true));
    }
    await tx.documentoLinea.createMany({ data: filas });
    await tx.producto.updateMany({ where: { codigo_producto: { in: filas.map(f => f.codigo_producto) } }, data: { fecha_ingreso: hace(DIAS_INGRESO[lote]) } });
    await fechar(tx, marca, hace(DIAS_INGRESO[lote]));
  }
  return { productos, huecoVacio: huecos[siguienteHueco] };
}

// Reingreso de productos que ya existen y salidas manuales (una deja un producto agotado)
async function cargarMovimientos(tx, cat, productos) {
  const unidad = { nombre: 'Unidad', factor: 1 };
  let marca = await marcar(tx);
  const reingreso = await nuevoDocumento(tx, 'INGRESO', 5, { origen: 'DONACION', terceroId: cat.terceros[1].id, tercero_nombre: cat.terceros[1].nombre, soporte: 'DEMO-REM-007', observaciones: 'DEMO: reingreso de productos existentes' }, persona(1));
  const filasIngreso = [];
  for (const [k, n] of [['camiseta', 60], ['cobija', 40], ['detergente', 25]]) {
    const actualizado = await sumarStock(tx, productos[k], n, persona(1), { documento: reingreso });
    filasIngreso.push(lineaDe(reingreso, actualizado, unidad, n, false));
  }
  await tx.documentoLinea.createMany({ data: filasIngreso });
  await fechar(tx, marca, hace(5));

  const salidas = [[45, ['zapato', 10], ['toalla', 15]], [20, ['crema', 6], ['champu', 20]], [3, ['olla', 5], ['cubiertos', 8]]];
  for (const [i, [dias, ...lineas]] of salidas.entries()) {
    marca = await marcar(tx);
    const organizacion = i === 1 ? null : cat.organizaciones[i + 4];
    const documento = await nuevoDocumento(tx, 'SALIDA', dias, {
      motivoId: cat.motivos.SALIDA.id, motivo_nombre: cat.motivos.SALIDA.nombre,
      organizacionId: organizacion?.id ?? null, organizacion_nombre: organizacion?.nombre ?? null, observaciones: 'DEMO: salida de ejemplo'
    }, persona(i));
    const filas = [];
    for (const [k, n] of lineas) {
      await retirarStock(tx, productos[k].codigo_producto, n, persona(i), { motivo: cat.motivos.SALIDA, documento, detalle: organizacion ? `. Destino: ${organizacion.nombre}` : '' });
      filas.push(lineaDe(documento, productos[k], unidad, n, false));
    }
    await tx.documentoLinea.createMany({ data: filas });
    await fechar(tx, marca, hace(dias));
  }

  // Una reubicación y un producto inactivo, para el kardex y los filtros del inventario
  marca = await marcar(tx);
  const destino = await resolverUbicacion(tx, (await huecosLibres(tx, 2))[1]);
  await tx.producto.update({ where: { id: productos.silla.id }, data: { ubicacion_general: destino.zona || 'Almacenamiento', codigo_estanteria: destino.codigo } });
  await registrarHistorial(tx, productos.silla.codigo_producto, 'REUBICACIÓN', persona(0), `Movido a: ${destino.codigo}`);
  await fechar(tx, marca, hace(40));
  marca = await marcar(tx);
  await tx.producto.update({ where: { id: productos.lampara.id }, data: { activo: false } });
  await registrarHistorial(tx, productos.lampara.codigo_producto, 'INACTIVACIÓN', persona(2), 'Justificación: producto de ejemplo fuera de catálogo');
  await fechar(tx, marca, hace(2));
}

const totales = (items, campo) => items.reduce((t, i) => ({ ...t, [i.codigo_producto]: (t[i.codigo_producto] || 0) + i[campo] }), {});

async function crearSbo(tx, productos, org, dias, lineas, { requerida, autor = persona(0), nota = 'DEMO: solicitud de ejemplo' } = {}) {
  const marca = await marcar(tx);
  const fecha = hace(dias);
  const codigo_sbo = await siguienteCodigoSbo(tx);
  const solicitud = await tx.solicitud.create({
    data: {
      codigo_sbo, beneficiario: org.nombre, organizacionId: org.id, creado_por: autor.usuario, observaciones: nota, fecha_solicitud: fecha,
      fecha_requerida: requerida === undefined ? null : hace(requerida),
      items: { create: lineas.map(([k, n]) => ({ codigo_producto: productos[k].codigo_producto, descripcion: productos[k].descripcion, cantidad_solicitada: n })) },
      eventos: { create: { estado_nuevo: 'CREADA', usuario: autor.usuario, fecha } }
    }
  });
  await registrarHistorial(tx, codigo_sbo, 'SBO CREADA', autor, `Solicitud para ${org.nombre} con ${lineas.length} ítem(s)`);
  await fechar(tx, marca, fecha);
  return solicitud;
}

// Misma lógica de stock y eventos que POST /solicitudes/:id/transicion. alistadas: { clave: unidades } para un alistamiento parcial
async function mover(tx, solicitud, accion, dias, productos, { autor = persona(0), alistador, alistadas = {}, nota } = {}) {
  const fecha = hace(dias);
  const marca = await marcar(tx);
  const actual = await tx.solicitud.findUnique({ where: { id: solicitud.id }, include: { items: true } });
  const { transicion, error } = validarTransicion(actual.estado, accion);
  if (error) throw new Error(`${actual.codigo_sbo}: ${error}`);
  const datos = { estado: transicion.hacia, [transicion.fecha]: fecha };
  const solicitadas = totales(actual.items, 'cantidad_solicitada');

  if (accion === 'aprobar') for (const [codigo, n] of Object.entries(solicitadas)) await reservarStock(tx, codigo, n);
  if (accion === 'cancelar' && ESTADOS_CON_RESERVA.includes(actual.estado)) for (const [codigo, n] of Object.entries(solicitadas)) await liberarReserva(tx, codigo, n);
  if (accion === 'iniciar') datos.alistador = alistador.usuario;
  if (accion === 'finalizar') {
    const cantidades = {};
    for (const [k, n] of Object.entries(alistadas)) cantidades[actual.items.find(i => i.codigo_producto === productos[k].codigo_producto).id] = n;
    for (const item of actual.items) await tx.solicitudItem.update({ where: { id: item.id }, data: { cantidad_alistada: cantidades[item.id] ?? item.cantidad_solicitada } });
    if (Object.keys(cantidades).length) await registrarFaltantes(tx, actual, actual.items, cantidades, nota, autor);
  }
  if (accion === 'despachar') {
    for (const [codigo, n] of Object.entries(totales(actual.items, 'cantidad_alistada'))) {
      await despacharReservado(tx, codigo, n, solicitadas[codigo]);
      if (n > 0) await registrarHistorial(tx, codigo, 'SALIDA SBO', autor, `Despacho de ${n} unidades. SBO ${actual.codigo_sbo} → ${actual.beneficiario}`);
    }
  }
  await tx.solicitud.update({ where: { id: actual.id }, data: datos });
  await tx.solicitudEvento.create({ data: { solicitudId: actual.id, estado_anterior: actual.estado, estado_nuevo: transicion.hacia, usuario: autor.usuario, nota, fecha } });
  await registrarHistorial(tx, actual.codigo_sbo, `SBO ${transicion.hacia}`, autor, nota || `${actual.estado} → ${transicion.hacia}${datos.alistador ? ` (alistador: ${datos.alistador})` : ''}`);
  await fechar(tx, marca, fecha);
}

// Lleva la solicitud por el flujo hasta "hasta", medio día entre cada paso
async function avanzar(tx, solicitud, dias, hasta, productos, indice, opciones = {}) {
  const pasos = ['aprobar', 'iniciar', 'finalizar', 'despachar'];
  const supervisor = persona(2), alistador = persona(indice);
  for (const [i, accion] of pasos.slice(0, pasos.indexOf(hasta) + 1).entries()) {
    await mover(tx, solicitud, accion, dias - (i + 1) * 0.5, productos, {
      autor: accion === 'iniciar' || accion === 'finalizar' ? alistador : supervisor, alistador,
      ...(accion === 'finalizar' ? opciones : {})
    });
  }
}

const itemDe = (tx, solicitud, producto) => tx.solicitudItem.findFirst({ where: { solicitudId: solicitud.id, codigo_producto: producto.codigo_producto } });

async function novedadFechada(tx, dias, fn) {
  const marca = await marcar(tx);
  await fn();
  await fechar(tx, marca, hace(dias));
}

async function cargarSolicitudes(tx, cat, productos) {
  const o = cat.organizaciones;
  // Despachadas: alimentan indicadores y tiempos de alistamiento (requerida - dias: algunas se cumplen tarde)
  const historicas = [
    [110, [['camiseta', 20], ['pantalon', 10]], 106], [95, [['zapato', 12], ['tenis', 6]], 96], [80, [['cobija', 15], ['sabana', 10]], 76],
    [65, [['jabon', 60], ['champu', 12]], 66], [50, [['panal', 50], ['toallitas', 10]], 46], [35, [['olla', 6], ['cubiertos', 10]], 31],
    [21, [['cuaderno', 40], ['lapices', 10]], 22], [12, [['morral', 8], ['juguete', 10]], 8]
  ];
  const despachadas = [];
  for (const [i, [dias, lineas, requerida]] of historicas.entries()) {
    const sbo = await crearSbo(tx, productos, o[i % o.length], dias, lineas, { requerida, autor: persona(i) });
    const parcial = i === 2 ? { alistadas: { sabana: 7 }, nota: 'DEMO: faltaron unidades al alistar' } : {};
    await avanzar(tx, sbo, dias, 'despachar', productos, i, parcial);
    despachadas.push(sbo);
  }
  await novedadFechada(tx, 45, async () => devolverItem(tx, despachadas[4].id, { itemId: (await itemDe(tx, despachadas[4], productos.toallitas)).id, cantidad: 3, descripcion: 'DEMO: la organización devolvió unidades sobrantes' }, persona(1)));
  await novedadFechada(tx, 30, async () => registrarNovedad(tx, despachadas[5].id, { tipo: 'DANADO', itemId: (await itemDe(tx, despachadas[5], productos.olla)).id, cantidad: 1, descripcion: 'DEMO: llegó una unidad golpeada', motivoId: cat.motivos.NOVEDAD.id }, persona(0)));

  // Canceladas y vencida
  const cancelada = await crearSbo(tx, productos, o[1], 70, [['chaqueta', 5]], { autor: persona(1) });
  await mover(tx, cancelada, 'cancelar', 69, productos, { autor: persona(2), nota: 'DEMO: la organización ya no la necesita' });
  const canceladaAprobada = await crearSbo(tx, productos, o[3], 25, [['medias', 30]], { autor: persona(0) });
  await mover(tx, canceladaAprobada, 'aprobar', 24.5, productos, { autor: persona(2) });
  await mover(tx, canceladaAprobada, 'cancelar', 24, productos, { autor: persona(2), nota: 'DEMO: cambio de prioridad' });
  const vencida = await crearSbo(tx, productos, o[6], 60, [['limpiador', 8]], { autor: persona(2) });
  await mover(tx, vencida, 'aprobar', 59.5, productos, { autor: persona(2) });
  await vencer(tx, vencida, 29.5);

  // En curso: una de cada estado, atrasadas y una cerca de vencerse por falta de movimiento
  await crearSbo(tx, productos, o[0], 2, [['camiseta', 15], ['medias', 20]], { requerida: -7 });
  await crearSbo(tx, productos, o[2], 1, [['linterna', 6], ['hamaca', 2]], { requerida: -3, autor: persona(1) });
  await crearSbo(tx, productos, o[5], 6, [['detergente', 10]], { requerida: 1, autor: persona(2) });
  const aprobada = await crearSbo(tx, productos, o[4], 3, [['toalla', 10], ['bolsas', 5]], { requerida: -2 });
  await avanzar(tx, aprobada, 3, 'aprobar', productos, 0);
  const porVencer = await crearSbo(tx, productos, o[7], 27.5, [['limpiador', 4]], { autor: persona(1) });
  await avanzar(tx, porVencer, 27.5, 'aprobar', productos, 1);
  const enAlistamiento = await crearSbo(tx, productos, o[1], 4, [['pantalon', 8], ['chaqueta', 4]], { requerida: 2 });
  await avanzar(tx, enAlistamiento, 4, 'iniciar', productos, 0);
  const conSustitucion = await crearSbo(tx, productos, o[6], 3, [['zapato', 4]], { requerida: -4, autor: persona(1) });
  await avanzar(tx, conSustitucion, 3, 'iniciar', productos, 1);
  await novedadFechada(tx, 1.5, async () => sustituirItem(tx, conSustitucion.id, { itemId: (await itemDe(tx, conSustitucion, productos.zapato)).id, codigo_sustituto: productos.tenis.codigo_producto, descripcion: 'DEMO: se reemplaza por disponibilidad de talla' }, persona(1)));
  const alistada = await crearSbo(tx, productos, o[3], 3, [['cobija', 6], ['juegomesa', 3]], { requerida: 1 });
  await avanzar(tx, alistada, 3, 'finalizar', productos, 0);
  const alistadaParcial = await crearSbo(tx, productos, o[5], 2, [['vajilla', 6], ['morral', 4]], { requerida: -1, autor: persona(2) });
  await avanzar(tx, alistadaParcial, 2, 'finalizar', productos, 1, { alistadas: { vajilla: 4 }, nota: 'DEMO: dos platos no estaban en el hueco' });
}

async function vencer(tx, solicitud, dias) {
  const marca = await marcar(tx);
  const actual = await tx.solicitud.findUnique({ where: { id: solicitud.id }, include: { items: true } });
  for (const [codigo, n] of Object.entries(totales(actual.items, 'cantidad_solicitada'))) await liberarReserva(tx, codigo, n);
  const nota = 'Vencida por 30 días sin movimiento';
  await tx.solicitud.update({ where: { id: actual.id }, data: { estado: 'VENCIDA', fecha_vencimiento: hace(dias) } });
  await tx.solicitudEvento.create({ data: { solicitudId: actual.id, estado_anterior: actual.estado, estado_nuevo: 'VENCIDA', usuario: SISTEMA.usuario, nota, fecha: hace(dias) } });
  await registrarHistorial(tx, actual.codigo_sbo, 'SBO VENCIDA', SISTEMA, `${nota}; se liberó la reserva`);
  await fechar(tx, marca, hace(dias));
}

async function nuevoConteo(tx, dias, productos, claves, observaciones, autor) {
  const ultimo = await tx.conteo.findFirst({ orderBy: { id: 'desc' }, select: { codigo: true } });
  const n = ultimo ? Number((ultimo.codigo.match(/(\d+)$/) || [0, 0])[1]) : 0;
  const lineas = await tx.producto.findMany({ where: { codigo_producto: { in: claves.map(k => productos[k].codigo_producto) } } });
  return tx.conteo.create({
    data: {
      codigo: `CNT-${String(n + 1).padStart(4, '0')}`, alcance: 'CATEGORIA', filtro: 'Muestra DEMO', observaciones, creado_por: autor.usuario, fecha_creacion: hace(dias),
      lineas: { create: lineas.map(p => ({ codigo_producto: p.codigo_producto, descripcion: p.descripcion, ubicacion: p.codigo_estanteria || p.ubicacion_general, cantidad_sistema: p.cantidad })) }
    },
    include: { lineas: true }
  });
}

async function cargarConteos(tx, cat, productos) {
  const marca = await marcar(tx);
  const cerrado = await nuevoConteo(tx, 40, productos, ['chaqueta', 'bolsas', 'balon', 'hamaca'], 'DEMO: conteo ya aprobado', persona(0));
  const diferencia = { [productos.chaqueta.codigo_producto]: -2, [productos.bolsas.codigo_producto]: 3 };
  await registrarConteo(tx, cerrado.id, cerrado.lineas.map(l => ({ id: l.id, cantidad_contada: l.cantidad_sistema + (diferencia[l.codigo_producto] || 0) })), persona(0));
  await aprobarConteo(tx, cerrado.id, { motivoId: cat.motivos.AJUSTE.id, observaciones: 'DEMO: conteo ya aprobado' }, persona(2));
  await tx.conteo.update({ where: { id: cerrado.id }, data: { fecha_cierre: hace(39) } });
  await fechar(tx, marca, hace(39));

  const abierto = await nuevoConteo(tx, 2, productos, ['olla', 'cubiertos', 'papel', 'linterna', 'juegomesa'], 'DEMO: conteo en curso', persona(1));
  await registrarConteo(tx, abierto.id, abierto.lineas.slice(0, 2).map((l, i) => ({ id: l.id, cantidad_contada: l.cantidad_sistema - i })), persona(1));
}

async function cargar(tx) {
  if (await tx.producto.count({ where: { descripcion: { startsWith: MARCA } } })) throw new Error('Ya hay datos DEMO cargados: bórrelos primero.');
  const cat = await asegurarCatalogos(tx);
  const { productos, huecoVacio } = await cargarIngresos(tx, cat);
  await cargarMovimientos(tx, cat, productos);
  await cargarSolicitudes(tx, cat, productos);
  await cargarConteos(tx, cat, productos);

  // Huecos llenos: dos con producto y uno vacío
  const marca = await marcar(tx);
  for (const p of [productos.camiseta, productos.cobija]) await marcarHuecoLleno(tx, p.ubicacion_general, true, SISTEMA);
  await marcarHuecoLleno(tx, huecoVacio, true, SISTEMA);
  await fechar(tx, marca, hace(1));
  return resumenDemo(tx);
}

async function resumenDemo(tx) {
  const conMarca = { descripcion: { startsWith: MARCA } };
  const [productos, organizaciones, terceros, documentos, solicitudes, novedades, conteos, huecos] = await Promise.all([
    tx.producto.count({ where: conMarca }),
    tx.organizacion.count({ where: { nombre: { startsWith: NOMBRE_DEMO } } }),
    tx.tercero.count({ where: { nombre: { startsWith: NOMBRE_DEMO } } }),
    tx.documento.count({ where: { observaciones: { startsWith: 'DEMO' } } }),
    tx.solicitud.count({ where: { observaciones: { startsWith: 'DEMO' } } }),
    tx.novedad.count({ where: { usuario: { startsWith: 'DEMO-' } } }),
    tx.conteo.count({ where: { observaciones: { startsWith: 'DEMO' } } }),
    tx.historial.count({ where: { accion: 'HUECO LLENO', operario: SISTEMA.usuario } })
  ]);
  return { productos, organizaciones, terceros, documentos, solicitudes, novedades, conteos, huecos_llenos: huecos };
}

// Borra lo ficticio y lo que se haya registrado a mano sobre esos productos. Si un documento o una SBO
// mezcla productos DEMO con reales, se detiene: borrarlo alteraría el stock real.
async function borrar(tx) {
  const productos = await tx.producto.findMany({ where: { descripcion: { startsWith: MARCA } }, select: { codigo_producto: true } });
  const codigos = productos.map(p => p.codigo_producto);
  const demo = new Set(codigos);
  const delDemo = { codigo_producto: { in: codigos } };
  const solicitudes = await tx.solicitud.findMany({
    where: { OR: [{ observaciones: { startsWith: 'DEMO' } }, { beneficiario: { startsWith: NOMBRE_DEMO } }, { items: { some: delDemo } }] },
    include: { items: { select: { codigo_producto: true } } }
  });
  const documentos = await tx.documento.findMany({
    where: { OR: [{ observaciones: { startsWith: 'DEMO' } }, { lineas: { some: delDemo } }] },
    include: { lineas: { select: { codigo_producto: true } } }
  });
  const mixtos = [
    ...solicitudes.filter(s => s.items.some(i => !demo.has(i.codigo_producto))).map(s => s.codigo_sbo),
    ...documentos.filter(d => d.lineas.some(l => !demo.has(l.codigo_producto))).map(d => d.numero)
  ];
  if (mixtos.length) throw new Error(`Estos registros mezclan productos DEMO con reales y deben revisarse a mano: ${mixtos.join(', ')}`);

  const idsSolicitudes = solicitudes.map(s => s.id);
  const codigosSbo = solicitudes.map(s => s.codigo_sbo);
  const idsDocumentos = documentos.map(d => d.id);
  const huecos = await tx.historial.findMany({ where: { accion: 'HUECO LLENO', operario: SISTEMA.usuario }, select: { codigo_producto: true } });
  await tx.ubicacion.updateMany({ where: { codigo: { in: huecos.map(h => h.codigo_producto) } }, data: { lleno: false } });

  await tx.novedad.deleteMany({ where: { OR: [{ solicitudId: { in: idsSolicitudes } }, delDemo, { codigo_sustituto: { in: codigos } }] } });
  await tx.historial.deleteMany({ where: { OR: [delDemo, { codigo_producto: { in: codigosSbo } }, { documentoId: { in: idsDocumentos } }, { operario: { startsWith: 'DEMO-' } }] } });
  await tx.solicitud.deleteMany({ where: { id: { in: idsSolicitudes } } });
  await tx.documento.deleteMany({ where: { id: { in: idsDocumentos } } });
  await tx.conteoLinea.deleteMany({ where: delDemo });
  await tx.conteo.deleteMany({ where: { OR: [{ observaciones: { startsWith: 'DEMO' } }, { lineas: { none: {} } }] } });
  await tx.producto.deleteMany({ where: delDemo });
  const nombre = { nombre: { startsWith: NOMBRE_DEMO } };
  await tx.organizacion.deleteMany({ where: nombre });
  await tx.tercero.deleteMany({ where: nombre });
  await tx.motivo.deleteMany({ where: nombre });
  await tx.unidadManejo.deleteMany({ where: nombre });
  return { productos: codigos.length, solicitudes: idsSolicitudes.length, documentos: idsDocumentos.length, huecos_liberados: huecos.length };
}

async function main() {
  const [comando] = process.argv.slice(2);
  if (!['cargar', 'borrar'].includes(comando)) throw new Error('Indique el comando: cargar o borrar.');
  const esquema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  console.log(`Base de destino: esquema ${esquema}`);
  if (esquema !== 'smi_pruebas' && !process.argv.includes('--produccion')) throw new Error('Esta no es smi_pruebas: agregue --produccion para confirmar.');
  if (!process.argv.includes('--aplicar')) {
    console.log(comando === 'cargar' ? `Cargaría ${ARTICULOS.flat().length} productos, ${ORGANIZACIONES.length} organizaciones y ${TERCEROS.length} terceros, con sus movimientos.` : `Datos DEMO actuales: ${JSON.stringify(await resumenDemo(prisma))}`);
    console.log('Solo se muestra. Agregue --aplicar para ejecutar.');
    return;
  }
  const resultado = await prisma.$transaction(tx => (comando === 'cargar' ? cargar(tx) : borrar(tx)), { maxWait: 30000, timeout: 20 * 60 * 1000 });
  console.log(`Listo (${comando}):`, JSON.stringify(resultado));
}

main().catch(e => { console.error('No se aplicó ningún cambio:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
