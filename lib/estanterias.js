// Mapa de Bodega: estanterías, generación de sus ubicaciones (huecos) y contenido para el mapa.
// Código de hueco: Z1-A-2-04 = zona Z1, rack A, nivel 2 (1 = abajo), hueco 04.
// Un producto está en una sola ubicación: su codigo_estanteria o, si no tiene, su ubicacion_general.
const { StockError } = require('./stock');

const LIMITES = { niveles: { min: 1, max: 6 }, huecos: { min: 1, max: 30 } };

const nombreZona = (zona) => `Zona ${zona.slice(1)}`;
const codigoHueco = (estanteria, nivel, hueco) => `${estanteria.codigo}-${nivel}-${String(hueco).padStart(2, '0')}`;
// Huecos de un nivel: del 2 hacia arriba pueden ser distintos (huecos_superiores)
const huecosEnNivel = (e, nivel) => (nivel >= 2 && e.huecos_superiores ? e.huecos_superiores : e.huecos);
const LIMITE_PLANO = 200; // cuadros

// Valida el cuerpo de una estantería. En una edición, zona y rack no cambian (los códigos quedan fijos).
function validarEstanteria(body, { parcial = false } = {}) {
  const data = {};
  if (!parcial) {
    const zona = String(body.zona ?? '').trim().toUpperCase();
    const rack = String(body.rack ?? '').trim().toUpperCase();
    if (!/^Z\d{1,2}$/.test(zona)) throw new StockError(400, 'Zona: escriba Z seguida de un número (ej. Z1).');
    if (!/^[A-Z]{1,2}$/.test(rack)) throw new StockError(400, 'Rack: una o dos letras sin tildes (ej. A).');
    Object.assign(data, { zona, rack, codigo: `${zona}-${rack}` });
  } else if ('zona' in body || 'rack' in body) {
    throw new StockError(400, 'La zona y el rack no se pueden cambiar: cree una estantería nueva.');
  }
  for (const campo of ['niveles', 'huecos']) {
    if (!(campo in body)) {
      if (!parcial) throw new StockError(400, `El campo "${campo}" es obligatorio.`);
      continue;
    }
    const n = Number(body[campo]);
    const { min, max } = LIMITES[campo];
    if (!Number.isInteger(n) || n < min || n > max) throw new StockError(400, `${campo === 'niveles' ? 'Niveles' : 'Huecos'}: número entero entre ${min} y ${max}.`);
    data[campo] = n;
  }
  if ('huecos_superiores' in body) {
    const v = body.huecos_superiores;
    if (v === null || v === '') data.huecos_superiores = null;
    else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < LIMITES.huecos.min || n > LIMITES.huecos.max) throw new StockError(400, `Huecos desde el nivel 2: número entero entre ${LIMITES.huecos.min} y ${LIMITES.huecos.max}, o vacío si son iguales al nivel 1.`);
      data.huecos_superiores = n;
    }
  }
  for (const campo of ['plano_x', 'plano_y']) {
    if (!(campo in body)) continue;
    const v = body[campo];
    if (v === null || v === '') { data[campo] = null; continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > LIMITE_PLANO) throw new StockError(400, `Posición en el plano: número entre 0 y ${LIMITE_PLANO}.`);
    data[campo] = n;
  }
  if ('plano_vertical' in body) {
    if (typeof body.plano_vertical !== 'boolean') throw new StockError(400, 'El campo "plano_vertical" debe ser verdadero o falso.');
    data.plano_vertical = body.plano_vertical;
  }
  if ('calle' in body) {
    const calle = typeof body.calle === 'string' ? body.calle.trim() : '';
    if (calle.length > 60) throw new StockError(400, 'Calle: máximo 60 caracteres.');
    data.calle = calle || null;
  }
  if ('orden' in body) {
    const n = Number(body.orden);
    if (!Number.isInteger(n) || n < 0 || n > 999) throw new StockError(400, 'Orden: número entero entre 0 y 999.');
    data.orden = n;
  }
  if ('activo' in body) {
    if (typeof body.activo !== 'boolean') throw new StockError(400, 'El campo "activo" debe ser verdadero o falso.');
    data.activo = body.activo;
  }
  return data;
}

// Productos (con o sin unidades) en una lista de códigos de ubicación, sin distinguir mayúsculas
async function ocupacion(tx, codigos) {
  if (codigos.length === 0) return [];
  const OR = codigos.flatMap(codigo => [
    { codigo_estanteria: { equals: codigo, mode: 'insensitive' } },
    { codigo_estanteria: null, ubicacion_general: { equals: codigo, mode: 'insensitive' } }
  ]);
  return tx.producto.findMany({ where: { OR, cantidad: { gt: 0 } }, select: { codigo_producto: true, codigo_estanteria: true, ubicacion_general: true } });
}

// Deja las ubicaciones de la estantería iguales a sus niveles y huecos por nivel. Los huecos que sobran se desactivan,
// salvo que tengan producto: entonces no se guarda nada y se explica qué reubicar.
async function sincronizarUbicaciones(tx, estanteria) {
  const deseados = [];
  if (estanteria.activo) {
    for (let nivel = 1; nivel <= estanteria.niveles; nivel++) {
      for (let hueco = 1; hueco <= huecosEnNivel(estanteria, nivel); hueco++) deseados.push({ codigo: codigoHueco(estanteria, nivel, hueco), nivel, hueco });
    }
  }
  const actuales = await tx.ubicacion.findMany({ where: { estanteriaId: estanteria.id } });
  const claves = new Set(deseados.map(d => d.codigo.toUpperCase()));
  const sobran = actuales.filter(u => u.activo && !claves.has(u.codigo.toUpperCase()));
  const ocupados = await ocupacion(tx, sobran.map(u => u.codigo));
  if (ocupados.length > 0) {
    const lugares = [...new Set(ocupados.map(p => p.codigo_estanteria || p.ubicacion_general))].sort();
    throw new StockError(409, `No se puede quitar ${lugares.length === 1 ? 'el hueco' : 'los huecos'} ${lugares.join(', ')}: ${ocupados.length === 1 ? 'tiene' : 'tienen'} producto(s) (${ocupados.map(p => p.codigo_producto).join(', ')}). Reubíquelos primero.`);
  }
  if (sobran.length > 0) await tx.ubicacion.updateMany({ where: { id: { in: sobran.map(u => u.id) } }, data: { activo: false } });

  // Pocas consultas por rack (la base es remota): las nuevas en un createMany, las existentes solo si cambian
  const zona = nombreZona(estanteria.zona);
  const datosDe = (d) => ({
    nombre: `Rack ${estanteria.rack} · nivel ${d.nivel} · hueco ${String(d.hueco).padStart(2, '0')}`,
    zona, estante: estanteria.rack, nivel: String(d.nivel), posicion: String(d.hueco).padStart(2, '0'),
    activo: true, estanteriaId: estanteria.id
  });
  const existentes = deseados.length === 0 ? [] : await tx.ubicacion.findMany({ where: { codigo: { in: deseados.map(d => d.codigo), mode: 'insensitive' } } });
  const porCodigo = Object.fromEntries(existentes.map(u => [u.codigo.toUpperCase(), u]));
  const nuevas = [];
  for (const d of deseados) {
    const datos = datosDe(d);
    const u = porCodigo[d.codigo.toUpperCase()];
    if (!u) nuevas.push({ codigo: d.codigo, ...datos });
    else if (Object.entries(datos).some(([k, v]) => u[k] !== v)) await tx.ubicacion.update({ where: { id: u.id }, data: datos });
  }
  if (nuevas.length > 0) await tx.ubicacion.createMany({ data: nuevas });
  return deseados.length;
}

async function crearEstanteria(tx, body) {
  const data = validarEstanteria(body);
  const repetida = await tx.estanteria.findFirst({ where: { codigo: { equals: data.codigo, mode: 'insensitive' } } });
  if (repetida) throw new StockError(409, `Ya existe la estantería ${data.codigo}.`);
  const estanteria = await tx.estanteria.create({ data });
  await sincronizarUbicaciones(tx, estanteria);
  return estanteria;
}

async function editarEstanteria(tx, id, body) {
  const data = validarEstanteria(body, { parcial: true });
  if (Object.keys(data).length === 0) throw new StockError(400, 'No hay cambios para guardar.');
  const actual = await tx.estanteria.findUnique({ where: { id } });
  if (!actual) throw new StockError(404, 'La estantería no existe.');
  const estanteria = await tx.estanteria.update({ where: { id }, data });
  await sincronizarUbicaciones(tx, estanteria);
  return estanteria;
}

// Lista para Configuración, con huecos activos y productos de cada estantería
async function listarEstanterias(prisma) {
  const estanterias = await prisma.estanteria.findMany({ orderBy: [{ zona: 'asc' }, { orden: 'asc' }, { rack: 'asc' }], include: { ubicaciones: { where: { activo: true }, select: { codigo: true } } } });
  const productos = await ocupacion(prisma, estanterias.flatMap(e => e.ubicaciones.map(u => u.codigo)));
  return estanterias.map(({ ubicaciones, ...e }) => {
    const codigos = new Set(ubicaciones.map(u => u.codigo.toUpperCase()));
    return { ...e, ubicaciones: ubicaciones.length, productos: productos.filter(p => codigos.has((p.codigo_estanteria || p.ubicacion_general).toUpperCase())).length };
  });
}

// Todo lo que pinta el mapa: zonas con sus estanterías (celdas nivel × hueco con productos) y áreas,
// más los productos con unidades que no están en ningún hueco de estantería ("fuera de estanterías").
async function mapaBodega(prisma) {
  const [estanterias, ubicaciones, productos, elementos] = await Promise.all([
    prisma.estanteria.findMany({ where: { activo: true }, orderBy: [{ zona: 'asc' }, { orden: 'asc' }, { rack: 'asc' }] }),
    prisma.ubicacion.findMany({ where: { activo: true }, orderBy: { codigo: 'asc' } }),
    prisma.producto.findMany({
      where: { cantidad: { gt: 0 } },
      orderBy: { codigo_producto: 'asc' },
      select: { id: true, codigo_producto: true, descripcion: true, categoria: true, cantidad: true, cantidad_reservada: true, condicion: true, talla: true, activo: true, codigo_estanteria: true, ubicacion_general: true }
    }),
    prisma.elementoPlano.findMany({ where: { activo: true }, orderBy: { id: 'asc' } })
  ]);

  const porUbicacion = {};
  for (const p of productos) {
    const clave = (p.codigo_estanteria || p.ubicacion_general).toUpperCase();
    (porUbicacion[clave] ||= []).push({ ...p, ubicacion: p.codigo_estanteria || p.ubicacion_general });
  }
  const contenido = (codigo) => {
    const lista = porUbicacion[codigo.toUpperCase()] || [];
    return { productos: lista, unidades: lista.reduce((s, p) => s + p.cantidad, 0) };
  };

  const zonas = {};
  const zonaDe = (clave, nombre) => (zonas[clave] ||= { zona: clave, nombre, estanterias: [], areas: [], plano: [] });
  const enEstanteria = new Set();
  const huecosDe = {};
  for (const u of ubicaciones) if (u.estanteriaId) (huecosDe[u.estanteriaId] ||= {})[`${u.nivel}-${u.posicion}`] = u;

  for (const e of estanterias) {
    const celdas = [];
    // De arriba hacia abajo, como se ve el rack de frente
    for (let nivel = e.niveles; nivel >= 1; nivel--) {
      for (let hueco = 1; hueco <= huecosEnNivel(e, nivel); hueco++) {
        const posicion = String(hueco).padStart(2, '0');
        const u = huecosDe[e.id]?.[`${nivel}-${posicion}`];
        const codigo = u?.codigo || codigoHueco(e, nivel, hueco);
        enEstanteria.add(codigo.toUpperCase());
        celdas.push({ codigo, nivel, hueco, ...contenido(codigo) });
      }
    }
    zonaDe(e.zona, nombreZona(e.zona)).estanterias.push({
      id: e.id, codigo: e.codigo, rack: e.rack, calle: e.calle, niveles: e.niveles, huecos: e.huecos, huecos_superiores: e.huecos_superiores,
      plano: e.plano_x === null || e.plano_y === null ? null : { x: e.plano_x, y: e.plano_y, vertical: e.plano_vertical },
      celdas
    });
  }

  // Áreas: ubicaciones activas que no son huecos de estantería (Recepción, Alistamiento, piso…)
  for (const u of ubicaciones) {
    if (u.estanteriaId) continue;
    const m = /^Zona (\d{1,2})$/.exec(u.zona || '');
    const zona = m ? zonaDe(`Z${m[1]}`, u.zona) : zonaDe('OTRAS', 'Otras ubicaciones');
    zona.areas.push({ codigo: u.codigo, nombre: u.nombre, ...contenido(u.codigo) });
  }

  // Plano: elementos que no son rack; un área enlazada trae sus unidades
  for (const el of elementos) {
    zonaDe(el.zona, nombreZona(el.zona)).plano.push({
      id: el.id, tipo: el.tipo, etiqueta: el.etiqueta, x: el.x, y: el.y, ancho: el.ancho, alto: el.alto, ubicacion: el.ubicacion,
      ...(el.ubicacion ? { unidades: contenido(el.ubicacion).unidades } : {})
    });
  }

  const fuera = productos
    .filter(p => !enEstanteria.has((p.codigo_estanteria || p.ubicacion_general).toUpperCase()))
    .map(p => ({ ...p, ubicacion: p.codigo_estanteria || p.ubicacion_general }));

  const lista = Object.values(zonas).sort((a, b) => (a.zona === 'OTRAS') - (b.zona === 'OTRAS') || a.zona.localeCompare(b.zona, 'es', { numeric: true }));
  return {
    zonas: lista,
    fuera_de_estanterias: fuera,
    resumen: {
      estanterias: estanterias.length,
      huecos: enEstanteria.size,
      huecos_ocupados: lista.flatMap(z => z.estanterias.flatMap(e => e.celdas)).filter(c => c.productos.length > 0).length,
      productos_en_estanterias: productos.length - fuera.length,
      productos_fuera: fuera.length
    }
  };
}

// Distribución inicial propuesta (bocetos del 26/10/2026). Se corrige luego en Configuración → Estanterías.
// En la Zona 1 los niveles 2 a 4 tienen un hueco más que el nivel 1 (corrección de los testers, 02/11/2026).
// Plano: en cuadros del boceto; cada rack mide 2 cuadros de fondo y 1,5 por hueco de largo.
const DISTRIBUCION_INICIAL = {
  estanterias: [
    { zona: 'Z1', rack: 'A', niveles: 4, huecos: 4, huecos_superiores: 5, orden: 1, plano_x: 6, plano_y: 3 },
    { zona: 'Z1', rack: 'B', niveles: 4, huecos: 4, huecos_superiores: 5, orden: 2, plano_x: 6, plano_y: 13.5 },
    { zona: 'Z1', rack: 'C', niveles: 4, huecos: 4, huecos_superiores: 5, orden: 3, plano_x: 11, plano_y: 3 },
    { zona: 'Z1', rack: 'D', niveles: 4, huecos: 4, huecos_superiores: 5, orden: 4, plano_x: 13.2, plano_y: 3 },
    { zona: 'Z1', rack: 'E', niveles: 4, huecos: 8, huecos_superiores: 9, orden: 5, plano_x: 1, plano_y: 3 },
    { zona: 'Z1', rack: 'F', niveles: 4, huecos: 4, huecos_superiores: 5, orden: 6, plano_x: 19.5, plano_y: 3 },
    { zona: 'Z1', rack: 'G', niveles: 4, huecos: 6, huecos_superiores: 7, orden: 7, plano_x: 11, plano_y: 13.5 },
    { zona: 'Z1', rack: 'H', niveles: 4, huecos: 6, huecos_superiores: 7, orden: 8, plano_x: 13.2, plano_y: 13.5 },
    { zona: 'Z1', rack: 'I', niveles: 4, huecos: 4, huecos_superiores: 5, orden: 9, plano_x: 19.5, plano_y: 13.5 },
    { zona: 'Z2', rack: 'J', niveles: 3, huecos: 3, orden: 1, plano_x: 23, plano_y: 4 }
  ],
  plano: [
    // Zona 1
    { zona: 'Z1', tipo: 'PC', etiqueta: 'PC', x: 3.6, y: 3, ancho: 1.8, alto: 1.8 },
    { zona: 'Z1', tipo: 'PASO', etiqueta: 'Paso (racks en altura)', x: 6, y: 11, ancho: 15.5, alto: 2.2 },
    { zona: 'Z1', tipo: 'AREA', etiqueta: 'Alistamiento 2', x: 2.5, y: 25, ancho: 5, alto: 6.5 },
    { zona: 'Z1', tipo: 'AREA', etiqueta: 'Alistamiento 1', x: 16.5, y: 25, ancho: 5, alto: 6.5 },
    { zona: 'Z1', tipo: 'PC', etiqueta: 'PC', x: 19.5, y: 29.5, ancho: 1.8, alto: 1.8 },
    { zona: 'Z1', tipo: 'AREA', etiqueta: 'Cajas', x: 22.5, y: 22, ancho: 4.5, alto: 5.5, ubicacion: 'Cajas' },
    { zona: 'Z1', tipo: 'ENTRADA', etiqueta: 'Entrada · Zona 2', x: 22, y: 3, ancho: 5, alto: 0.8 },
    { zona: 'Z1', tipo: 'ENTRADA', etiqueta: 'Entrada', x: 26.5, y: 13.5, ancho: 0.8, alto: 5 },
    { zona: 'Z1', tipo: 'PUERTA', etiqueta: 'Puerta', x: 0.5, y: 34, ancho: 5, alto: 0.8 },
    { zona: 'Z1', tipo: 'PUERTA', etiqueta: 'Puerta', x: 21, y: 34, ancho: 5, alto: 0.8 },
    { zona: 'Z1', tipo: 'CALLE', etiqueta: 'Calle Pepe Ganga', x: 0, y: 18, ancho: 5, alto: 1 },
    { zona: 'Z1', tipo: 'CALLE', etiqueta: 'Calle Mc Cain', x: 2.5, y: 0.5, ancho: 4.5, alto: 1 },
    { zona: 'Z1', tipo: 'CALLE', etiqueta: 'Calle Loreal', x: 5, y: 22, ancho: 4.5, alto: 1 },
    { zona: 'Z1', tipo: 'CALLE', etiqueta: 'Calle Mattel · Todos', x: 7.5, y: 0.5, ancho: 5.5, alto: 1 },
    { zona: 'Z1', tipo: 'CALLE', etiqueta: 'Calle Accesorios y Valores', x: 13, y: 0.5, ancho: 6, alto: 1 },
    { zona: 'Z1', tipo: 'CALLE', etiqueta: 'Calle Comapan', x: 19.5, y: 0.5, ancho: 4.5, alto: 1 },
    { zona: 'Z1', tipo: 'CALLE', etiqueta: 'Calle Nacional Chocolates', x: 9.5, y: 26, ancho: 6, alto: 1 },
    { zona: 'Z1', tipo: 'CALLE', etiqueta: 'Calle Koller', x: 10.5, y: 28, ancho: 4.5, alto: 1 },
    { zona: 'Z1', tipo: 'CALLE', etiqueta: 'Calle Koaj', x: 22.5, y: 28.5, ancho: 4.5, alto: 1 },
    // Zona 2
    { zona: 'Z2', tipo: 'AREA', etiqueta: 'Almacenamiento a piso', x: 10, y: 4, ancho: 7.5, alto: 12.5, ubicacion: 'Almacenamiento a piso' },
    { zona: 'Z2', tipo: 'ENTRADA', etiqueta: 'Entrada · Zona 1', x: 18, y: 3.5, ancho: 4.5, alto: 0.8 },
    { zona: 'Z2', tipo: 'ENTRADA', etiqueta: 'Entrada · Plaza Ikea', x: 13.5, y: 17.5, ancho: 0.8, alto: 4 },
    { zona: 'Z2', tipo: 'ENTRADA', etiqueta: 'Entrada', x: 23, y: 21, ancho: 4, alto: 0.8 },
    { zona: 'Z2', tipo: 'ENTRADA', etiqueta: 'Entrada · Plaza orden de moda', x: 28, y: 16.5, ancho: 0.8, alto: 4 },
    { zona: 'Z2', tipo: 'AREA', etiqueta: 'Exhibición de muebles', x: 20, y: 22.5, ancho: 10, alto: 3, ubicacion: 'Exhibición de muebles' },
    { zona: 'Z2', tipo: 'CALLE', etiqueta: 'Calle Banco Av Villas', x: 17, y: 0.3, ancho: 6, alto: 1 },
    { zona: 'Z2', tipo: 'CALLE', etiqueta: 'Calle Heals de Colombia', x: 23.5, y: 1.8, ancho: 6, alto: 1 }
  ],
  // Las zonas de alistamiento son mesas de empaque: se dibujan en el plano pero no son ubicaciones (no se guarda nada allí)
  areasDeTrabajo: ['Alistamiento 1', 'Alistamiento 2'],
  areas: [
    { codigo: 'Cajas', nombre: 'Área de cajas', zona: 'Zona 1' },
    { codigo: 'Almacenamiento a piso', nombre: 'Almacenamiento a piso', zona: 'Zona 2' },
    { codigo: 'Exhibición de muebles', nombre: 'Exhibición de muebles (plaza Ikea)', zona: 'Zona 2' }
  ]
};

// Crea lo que falte de la distribución inicial; no toca lo que ya exista. Devuelve lo creado.
async function crearDistribucionInicial(tx, distribucion = DISTRIBUCION_INICIAL) {
  const creado = { estanterias: [], areas: [] };
  for (const e of distribucion.estanterias) {
    if (await tx.estanteria.findFirst({ where: { codigo: `${e.zona}-${e.rack}` } })) continue;
    creado.estanterias.push((await crearEstanteria(tx, e)).codigo);
  }
  for (const a of distribucion.areas) {
    if (await tx.ubicacion.findFirst({ where: { codigo: { equals: a.codigo, mode: 'insensitive' } } })) continue;
    await tx.ubicacion.create({ data: a });
    creado.areas.push(a.codigo);
  }
  creado.plano = await completarPlano(tx, distribucion);
  return creado;
}

// Para una bodega ya cargada: agrega a los racks existentes lo que les falte de la distribución
// (huecos de los niveles superiores y posición en el plano) y crea el plano de las zonas que no lo tienen.
// No cambia lo que ya se haya configurado. Devuelve qué cambió.
async function completarPlano(tx, distribucion = DISTRIBUCION_INICIAL) {
  const cambios = { racks: [], elementos: 0, areas_retiradas: [], areas_con_producto: [] };
  for (const d of distribucion.estanterias) {
    const e = await tx.estanteria.findFirst({ where: { codigo: `${d.zona}-${d.rack}` } });
    if (!e) continue;
    const datos = {};
    if (d.huecos_superiores && e.huecos_superiores === null && e.huecos === d.huecos) datos.huecos_superiores = d.huecos_superiores;
    if (e.plano_x === null && e.plano_y === null && d.plano_x !== undefined) Object.assign(datos, { plano_x: d.plano_x, plano_y: d.plano_y });
    if (Object.keys(datos).length === 0) continue;
    await editarEstanteria(tx, e.id, datos);
    cambios.racks.push(`${e.codigo} (${Object.keys(datos).join(', ')})`);
  }
  const zonasConPlano = new Set((await tx.elementoPlano.findMany({ select: { zona: true }, distinct: ['zona'] })).map(z => z.zona));
  const nuevos = (distribucion.plano || []).filter(el => !zonasConPlano.has(el.zona));
  if (nuevos.length) await tx.elementoPlano.createMany({ data: nuevos });
  cambios.elementos = nuevos.length;
  await retirarAreasDeTrabajo(tx, distribucion, cambios);
  return cambios;
}

// Las áreas de trabajo (Alistamiento) dejan de ser ubicaciones: se quita el enlace del plano y se desactivan.
// Si alguna aún tiene producto, no se toca y se informa (primero hay que reubicarlo).
async function retirarAreasDeTrabajo(tx, distribucion, cambios) {
  for (const codigo of distribucion.areasDeTrabajo || []) {
    const u = await tx.ubicacion.findFirst({ where: { codigo: { equals: codigo, mode: 'insensitive' }, estanteriaId: null } });
    if (!u) continue;
    const conProducto = await tx.producto.count({ where: { cantidad: { gt: 0 }, OR: [{ codigo_estanteria: u.codigo }, { ubicacion_general: u.codigo }] } });
    if (conProducto > 0) { cambios.areas_con_producto.push(`${u.codigo} (${conProducto} productos)`); continue; }
    const enlaces = await tx.elementoPlano.updateMany({ where: { ubicacion: u.codigo }, data: { ubicacion: null } });
    if (u.activo) await tx.ubicacion.update({ where: { id: u.id }, data: { activo: false } });
    if (u.activo || enlaces.count) cambios.areas_retiradas.push(u.codigo);
  }
}

// ---- Elementos del plano (Configuración → Plano) ----
const TIPOS_ELEMENTO = ['AREA', 'ENTRADA', 'PUERTA', 'CALLE', 'PC', 'PASO'];

function validarElemento(body, { parcial = false } = {}) {
  const data = {};
  if ('zona' in body || !parcial) {
    const zona = String(body.zona ?? '').trim().toUpperCase();
    if (!/^Z\d{1,2}$/.test(zona)) throw new StockError(400, 'Zona: escriba Z seguida de un número (ej. Z1).');
    data.zona = zona;
  }
  if ('tipo' in body || !parcial) {
    if (!TIPOS_ELEMENTO.includes(body.tipo)) throw new StockError(400, `Tipo inválido. Use: ${TIPOS_ELEMENTO.join(', ')}.`);
    data.tipo = body.tipo;
  }
  if ('etiqueta' in body || !parcial) {
    const etiqueta = typeof body.etiqueta === 'string' ? body.etiqueta.trim() : '';
    if (!etiqueta || etiqueta.length > 60) throw new StockError(400, 'Etiqueta: obligatoria, máximo 60 caracteres.');
    data.etiqueta = etiqueta;
  }
  for (const campo of ['x', 'y', 'ancho', 'alto']) {
    if (!(campo in body)) {
      if (!parcial) throw new StockError(400, `El campo "${campo}" es obligatorio.`);
      continue;
    }
    const n = Number(body[campo]);
    const min = campo === 'ancho' || campo === 'alto' ? 0.5 : 0;
    if (body[campo] === '' || body[campo] === null || !Number.isFinite(n) || n < min || n > LIMITE_PLANO) throw new StockError(400, `${campo}: número entre ${min} y ${LIMITE_PLANO}.`);
    data[campo] = n;
  }
  if ('ubicacion' in body) {
    const u = typeof body.ubicacion === 'string' ? body.ubicacion.trim() : '';
    data.ubicacion = u || null;
  }
  if ('activo' in body) {
    if (typeof body.activo !== 'boolean') throw new StockError(400, 'El campo "activo" debe ser verdadero o falso.');
    data.activo = body.activo;
  }
  return data;
}

// id null crea; si no, edita. Un área enlazada debe ser una ubicación activa que no sea hueco de rack.
async function guardarElemento(tx, id, body) {
  const data = validarElemento(body, { parcial: id !== null });
  if (data.ubicacion) {
    const u = await tx.ubicacion.findFirst({ where: { codigo: { equals: data.ubicacion, mode: 'insensitive' }, activo: true, estanteriaId: null } });
    if (!u) throw new StockError(400, `La ubicación "${data.ubicacion}" no existe o es un hueco de estantería. Enlace un área (Recepción, Alistamiento…).`);
    data.ubicacion = u.codigo;
  }
  if (id === null) return tx.elementoPlano.create({ data });
  if (!(await tx.elementoPlano.findUnique({ where: { id } }))) throw new StockError(404, 'El elemento del plano no existe.');
  if (Object.keys(data).length === 0) throw new StockError(400, 'No hay cambios para guardar.');
  return tx.elementoPlano.update({ where: { id }, data });
}

module.exports = { validarEstanteria, crearEstanteria, editarEstanteria, listarEstanterias, mapaBodega, crearDistribucionInicial, completarPlano, DISTRIBUCION_INICIAL, codigoHueco, huecosEnNivel, validarElemento, guardarElemento, TIPOS_ELEMENTO };
