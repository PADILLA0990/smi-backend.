// Mapa de Bodega: estanterías, generación de sus ubicaciones (huecos) y contenido para el mapa.
// Código de hueco: Z1-A-2-04 = zona Z1, rack A, nivel 2 (1 = abajo), hueco 04.
// Un producto está en una sola ubicación: su codigo_estanteria o, si no tiene, su ubicacion_general.
const { StockError } = require('./stock');

const LIMITES = { niveles: { min: 1, max: 6 }, huecos: { min: 1, max: 30 } };

const nombreZona = (zona) => `Zona ${zona.slice(1)}`;
const codigoHueco = (estanteria, nivel, hueco) => `${estanteria.codigo}-${nivel}-${String(hueco).padStart(2, '0')}`;

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

// Deja las ubicaciones de la estantería iguales a niveles × huecos. Los huecos que sobran se desactivan,
// salvo que tengan producto: entonces no se guarda nada y se explica qué reubicar.
async function sincronizarUbicaciones(tx, estanteria) {
  const deseados = [];
  if (estanteria.activo) {
    for (let nivel = 1; nivel <= estanteria.niveles; nivel++) {
      for (let hueco = 1; hueco <= estanteria.huecos; hueco++) deseados.push({ codigo: codigoHueco(estanteria, nivel, hueco), nivel, hueco });
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
  const [estanterias, ubicaciones, productos] = await Promise.all([
    prisma.estanteria.findMany({ where: { activo: true }, orderBy: [{ zona: 'asc' }, { orden: 'asc' }, { rack: 'asc' }] }),
    prisma.ubicacion.findMany({ where: { activo: true }, orderBy: { codigo: 'asc' } }),
    prisma.producto.findMany({
      where: { cantidad: { gt: 0 } },
      orderBy: { codigo_producto: 'asc' },
      select: { id: true, codigo_producto: true, descripcion: true, categoria: true, cantidad: true, cantidad_reservada: true, condicion: true, talla: true, activo: true, codigo_estanteria: true, ubicacion_general: true }
    })
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
  const zonaDe = (clave, nombre) => (zonas[clave] ||= { zona: clave, nombre, estanterias: [], areas: [] });
  const enEstanteria = new Set();
  const huecosDe = {};
  for (const u of ubicaciones) if (u.estanteriaId) (huecosDe[u.estanteriaId] ||= {})[`${u.nivel}-${u.posicion}`] = u;

  for (const e of estanterias) {
    const celdas = [];
    // De arriba hacia abajo, como se ve el rack de frente
    for (let nivel = e.niveles; nivel >= 1; nivel--) {
      for (let hueco = 1; hueco <= e.huecos; hueco++) {
        const posicion = String(hueco).padStart(2, '0');
        const u = huecosDe[e.id]?.[`${nivel}-${posicion}`];
        const codigo = u?.codigo || codigoHueco(e, nivel, hueco);
        enEstanteria.add(codigo.toUpperCase());
        celdas.push({ codigo, nivel, hueco, ...contenido(codigo) });
      }
    }
    zonaDe(e.zona, nombreZona(e.zona)).estanterias.push({ id: e.id, codigo: e.codigo, rack: e.rack, calle: e.calle, niveles: e.niveles, huecos: e.huecos, celdas });
  }

  // Áreas: ubicaciones activas que no son huecos de estantería (Recepción, Alistamiento, piso…)
  for (const u of ubicaciones) {
    if (u.estanteriaId) continue;
    const m = /^Zona (\d{1,2})$/.exec(u.zona || '');
    const zona = m ? zonaDe(`Z${m[1]}`, u.zona) : zonaDe('OTRAS', 'Otras ubicaciones');
    zona.areas.push({ codigo: u.codigo, nombre: u.nombre, ...contenido(u.codigo) });
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
const DISTRIBUCION_INICIAL = {
  estanterias: [
    ...['A', 'B', 'C', 'D'].map((rack, i) => ({ zona: 'Z1', rack, niveles: 4, huecos: 4, orden: i + 1 })),
    { zona: 'Z1', rack: 'E', niveles: 4, huecos: 8, orden: 5 },
    { zona: 'Z1', rack: 'F', niveles: 4, huecos: 4, orden: 6 },
    { zona: 'Z1', rack: 'G', niveles: 4, huecos: 6, orden: 7 },
    { zona: 'Z1', rack: 'H', niveles: 4, huecos: 6, orden: 8 },
    { zona: 'Z1', rack: 'I', niveles: 4, huecos: 4, orden: 9 },
    { zona: 'Z2', rack: 'J', niveles: 3, huecos: 3, orden: 1 }
  ],
  areas: [
    { codigo: 'Alistamiento 1', nombre: 'Zona de alistamiento 1 (con PC)', zona: 'Zona 1' },
    { codigo: 'Alistamiento 2', nombre: 'Zona de alistamiento 2 (con PC)', zona: 'Zona 1' },
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
  return creado;
}

module.exports = { validarEstanteria, crearEstanteria, editarEstanteria, listarEstanterias, mapaBodega, crearDistribucionInicial, DISTRIBUCION_INICIAL, codigoHueco };
