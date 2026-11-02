// Codificación de productos 001-RCM-B (docs/CODIFICACION.md):
// consecutivo (001–999) - categoría, subcategoría y variante (una letra cada una) - estado del objeto (P, B, D, X).
// El mismo artículo en otro estado comparte la base y cambia solo el sufijo; cada estado tiene su propio stock.
// Las categorías sin letra (anteriores a la codificación) siguen aceptando códigos libres.
const { StockError } = require('./stock');

const SUFIJO = { PERFECTO: 'P', BUENO: 'B', DETERIORO: 'D', DANADO: 'X' };
const PATRON = /^(\d{3})-([A-Z])([A-Z])([A-Z])-([PBDX])$/;

const letraValida = (v, etiqueta) => {
  const l = String(v ?? '').trim().toUpperCase();
  if (!/^[A-Z]$/.test(l)) throw new StockError(400, `${etiqueta}: una sola letra sin tildes (A–Z).`);
  return l;
};
const nombreValido = (v, etiqueta, max = 60) => {
  const n = typeof v === 'string' ? v.trim() : '';
  if (!n || n.length > max) throw new StockError(400, `${etiqueta}: obligatorio, máximo ${max} caracteres.`);
  return n;
};

// Mismo artículo en otro estado: 001-RCM-B → 001-RCM-D. Null si el código no sigue la codificación.
function codigoHermano(codigo, condicion) {
  const m = PATRON.exec(String(codigo || '').toUpperCase());
  if (!m || !SUFIJO[condicion]) return null;
  return `${m[1]}-${m[2]}${m[3]}${m[4]}-${SUFIJO[condicion]}`;
}

// Categoría con letra, subcategoría y variante activas de esa categoría
async function resolverNiveles(tx, categoria, subcategoriaId, varianteId) {
  const [sub, variante] = await Promise.all([
    /^\d+$/.test(String(subcategoriaId ?? '')) ? tx.subcategoria.findUnique({ where: { id: Number(subcategoriaId) } }) : null,
    /^\d+$/.test(String(varianteId ?? '')) ? tx.variante.findUnique({ where: { id: Number(varianteId) } }) : null
  ]);
  if (!sub || sub.categoriaId !== categoria.id) throw new StockError(400, `Elija la subcategoría de ${categoria.nombre}.`);
  if (!variante || variante.categoriaId !== categoria.id) throw new StockError(400, `Elija ${(categoria.nombre_variante || 'la variante').toLowerCase()} de ${categoria.nombre}.`);
  if (!sub.activo) throw new StockError(400, `La subcategoría "${sub.nombre}" fue desactivada.`);
  if (!variante.activo) throw new StockError(400, `"${variante.nombre}" fue desactivado.`);
  return { sub, variante };
}

// Siguiente código libre para la combinación: el mayor consecutivo de esas letras (en cualquier estado) + 1.
// "excluir": códigos ya usados en el formulario que aún no se guardan (varios productos nuevos en un documento).
async function siguienteCodigo(tx, { categoriaId, subcategoriaId, varianteId, condicion, excluir = [] }) {
  const categoria = await tx.categoria.findUnique({ where: { id: Number(categoriaId) || 0 } });
  if (!categoria) throw new StockError(404, 'La categoría no existe.');
  if (!categoria.letra) return { codigo: null };
  if (!SUFIJO[condicion]) throw new StockError(400, 'Elija el estado del objeto.');
  const { sub, variante } = await resolverNiveles(tx, categoria, subcategoriaId, varianteId);
  const base = `${categoria.letra}${sub.letra}${variante.letra}`;
  const existentes = await tx.producto.findMany({ where: { codigo_producto: { contains: `-${base}-` } }, select: { codigo_producto: true } });
  let mayor = 0;
  for (const codigo of [...existentes.map(p => p.codigo_producto), ...excluir]) {
    const m = PATRON.exec(String(codigo).toUpperCase());
    if (m && `${m[2]}${m[3]}${m[4]}` === base) mayor = Math.max(mayor, Number(m[1]));
  }
  if (mayor >= 999) throw new StockError(409, `Se agotaron los consecutivos de ${base} (999).`);
  return { codigo: `${String(mayor + 1).padStart(3, '0')}-${base}-${SUFIJO[condicion]}` };
}

// Al crear un producto de una categoría codificada: exige subcategoría, variante y estado, y que el código
// coincida con ellos. Devuelve los campos a guardar en el producto.
async function validarCodificacion(tx, categoria, datos, codigo) {
  if (!categoria.letra) return {};
  if (!SUFIJO[datos.condicion]) throw new StockError(400, `${categoria.nombre} usa la codificación 001-${categoria.letra}XX-B: indique el estado del objeto.`);
  const { sub, variante } = await resolverNiveles(tx, categoria, datos.subcategoriaId, datos.varianteId);
  const esperado = `${categoria.letra}${sub.letra}${variante.letra}`;
  const m = PATRON.exec(codigo);
  if (!m || `${m[2]}${m[3]}${m[4]}` !== esperado || m[5] !== SUFIJO[datos.condicion] || m[1] === '000') {
    throw new StockError(400, `El código debe tener la forma 001-${esperado}-${SUFIJO[datos.condicion]} (consecutivo, letras de ${categoria.nombre} › ${sub.nombre} › ${variante.nombre} y estado).`);
  }
  return { subcategoriaId: sub.id, varianteId: variante.id };
}

// Un producto codificado no cambia de categoría ni de estado: su código depende de ellos
function esCodificado(producto) {
  return Boolean(producto.subcategoriaId || producto.varianteId) && PATRON.test(producto.codigo_producto);
}

// --- Árbol (Configuración → Codificación) ---
async function arbol(prisma) {
  const categorias = await prisma.categoria.findMany({
    orderBy: [{ letra: 'asc' }, { nombre: 'asc' }],
    include: { subcategorias: { orderBy: { letra: 'asc' } }, variantes: { orderBy: { letra: 'asc' } } }
  });
  const usos = await prisma.producto.groupBy({ by: ['subcategoriaId', 'varianteId'], _count: true, where: { OR: [{ subcategoriaId: { not: null } }, { varianteId: { not: null } }] } });
  const porSub = {}, porVar = {};
  for (const u of usos) {
    if (u.subcategoriaId) porSub[u.subcategoriaId] = (porSub[u.subcategoriaId] || 0) + u._count;
    if (u.varianteId) porVar[u.varianteId] = (porVar[u.varianteId] || 0) + u._count;
  }
  return categorias.map(c => ({
    id: c.id, nombre: c.nombre, letra: c.letra, nombre_variante: c.nombre_variante, activo: c.activo,
    subcategorias: c.subcategorias.map(s => ({ ...s, productos: porSub[s.id] || 0 })),
    variantes: c.variantes.map(v => ({ ...v, productos: porVar[v.id] || 0 }))
  }));
}

async function editarCategoriaCodigo(tx, id, body) {
  const actual = await tx.categoria.findUnique({ where: { id } });
  if (!actual) throw new StockError(404, 'La categoría no existe.');
  const data = {};
  if ('letra' in body) {
    data.letra = body.letra === null || body.letra === '' ? null : letraValida(body.letra, 'Letra de la categoría');
    if (data.letra !== actual.letra) {
      const usados = await tx.producto.count({ where: { categoriaId: id, OR: [{ subcategoriaId: { not: null } }, { varianteId: { not: null } }] } });
      if (usados > 0) throw new StockError(409, `${actual.nombre} ya tiene ${usados} producto(s) codificados: su letra no se puede cambiar.`);
      if (data.letra && await tx.categoria.findFirst({ where: { letra: data.letra, NOT: { id } } })) throw new StockError(409, `La letra ${data.letra} ya es de otra categoría.`);
    }
  }
  if ('nombre_variante' in body) data.nombre_variante = body.nombre_variante ? nombreValido(body.nombre_variante, 'Nombre del nivel 3', 30) : null;
  if (Object.keys(data).length === 0) throw new StockError(400, 'No hay cambios para guardar.');
  return tx.categoria.update({ where: { id }, data });
}

// Subcategorías y variantes comparten reglas: letra única dentro de la categoría y fija si ya hay productos
const MODELOS = { subcategorias: { modelo: 'subcategoria', campo: 'subcategoriaId', etiqueta: 'subcategoría' }, variantes: { modelo: 'variante', campo: 'varianteId', etiqueta: 'variante' } };

async function crearNivel(tx, tipo, categoriaId, body) {
  const { modelo, etiqueta } = MODELOS[tipo];
  const categoria = await tx.categoria.findUnique({ where: { id: categoriaId } });
  if (!categoria) throw new StockError(404, 'La categoría no existe.');
  const letra = letraValida(body.letra, `Letra de la ${etiqueta}`);
  const nombre = nombreValido(body.nombre, `Nombre de la ${etiqueta}`);
  if (await tx[modelo].findUnique({ where: { categoriaId_letra: { categoriaId, letra } } })) throw new StockError(409, `${categoria.nombre} ya tiene una ${etiqueta} con la letra ${letra}.`);
  return tx[modelo].create({ data: { categoriaId, letra, nombre } });
}

async function editarNivel(tx, tipo, id, body) {
  const { modelo, campo, etiqueta } = MODELOS[tipo];
  const actual = await tx[modelo].findUnique({ where: { id } });
  if (!actual) throw new StockError(404, `La ${etiqueta} no existe.`);
  const data = {};
  if ('nombre' in body) data.nombre = nombreValido(body.nombre, `Nombre de la ${etiqueta}`);
  if ('letra' in body) {
    data.letra = letraValida(body.letra, `Letra de la ${etiqueta}`);
    if (data.letra !== actual.letra) {
      if (await tx.producto.count({ where: { [campo]: id } })) throw new StockError(409, `La ${etiqueta} "${actual.nombre}" ya tiene productos: su letra no se puede cambiar.`);
      if (await tx[modelo].findUnique({ where: { categoriaId_letra: { categoriaId: actual.categoriaId, letra: data.letra } } })) throw new StockError(409, `Ya hay una ${etiqueta} con la letra ${data.letra} en esta categoría.`);
    }
  }
  if ('activo' in body) {
    if (typeof body.activo !== 'boolean') throw new StockError(400, 'El campo "activo" debe ser verdadero o falso.');
    data.activo = body.activo;
  }
  if (Object.keys(data).length === 0) throw new StockError(400, 'No hay cambios para guardar.');
  return tx[modelo].update({ where: { id }, data });
}

// Árbol propuesto (aprobado el 31/10/2026). "antes": nombres de las categorías actuales que pasan a ser esta.
const PUBLICO = [['H', 'Hombre'], ['M', 'Mujer'], ['N', 'Niño/a'], ['B', 'Bebé'], ['U', 'Unisex']];
const PRESENTACION = [['I', 'Individual'], ['P', 'Paquete'], ['K', 'Kit'], ['G', 'Granel']];
const ARBOL_INICIAL = [
  { letra: 'R', nombre: 'Ropa', antes: ['Textiles'], variante: 'Público', variantes: PUBLICO,
    subcategorias: [['C', 'Camisas y blusas'], ['P', 'Pantalones y faldas'], ['A', 'Abrigos y chaquetas'], ['I', 'Ropa interior y medias'], ['D', 'Deportiva'], ['U', 'Uniformes'], ['O', 'Otros']] },
  { letra: 'Z', nombre: 'Calzado', antes: [], variante: 'Público', variantes: PUBLICO,
    subcategorias: [['Z', 'Zapatos'], ['T', 'Tenis'], ['B', 'Botas'], ['S', 'Sandalias'], ['O', 'Otros']] },
  { letra: 'T', nombre: 'Textiles del hogar', antes: [], variante: 'Tamaño',
    variantes: [['I', 'Infantil'], ['S', 'Sencillo'], ['D', 'Doble'], ['G', 'Grande (queen/king)'], ['U', 'Única']],
    subcategorias: [['C', 'Cobijas'], ['S', 'Sábanas y fundas'], ['T', 'Toallas'], ['A', 'Almohadas'], ['L', 'Colchonetas'], ['O', 'Otros']] },
  { letra: 'H', nombre: 'Higiene personal', antes: ['Aseo no perecedero'], variante: 'Presentación', variantes: PRESENTACION,
    subcategorias: [['J', 'Jabón'], ['C', 'Champú y acondicionador'], ['D', 'Cuidado dental'], ['E', 'Desodorante'], ['F', 'Higiene femenina'], ['P', 'Papel higiénico'], ['A', 'Afeitado'], ['O', 'Otros']] },
  { letra: 'B', nombre: 'Bebé', antes: [], variante: 'Etapa o talla',
    variantes: [['R', 'Recién nacido'], ['P', 'Pequeño'], ['M', 'Mediano'], ['G', 'Grande'], ['U', 'Única']],
    subcategorias: [['P', 'Pañales'], ['T', 'Toallitas húmedas'], ['A', 'Alimentación (teteros, vasos)'], ['C', 'Coches y cargadores'], ['O', 'Otros']] },
  { letra: 'A', nombre: 'Aseo del hogar', antes: [], variante: 'Presentación', variantes: PRESENTACION,
    subcategorias: [['D', 'Detergentes'], ['L', 'Limpiadores y desinfectantes'], ['U', 'Utensilios (escobas, traperos)'], ['P', 'Papel y desechables'], ['B', 'Bolsas'], ['O', 'Otros']] },
  { letra: 'C', nombre: 'Cocina y menaje', antes: ['Hogar'], variante: 'Material',
    variantes: [['M', 'Metal'], ['P', 'Plástico'], ['V', 'Vidrio o cerámica'], ['E', 'Eléctrico'], ['X', 'Mixto']],
    subcategorias: [['O', 'Ollas y sartenes'], ['V', 'Vajilla'], ['C', 'Cubiertos'], ['U', 'Utensilios'], ['R', 'Recipientes'], ['E', 'Electrodomésticos pequeños'], ['X', 'Otros']] },
  { letra: 'M', nombre: 'Muebles', antes: [], variante: 'Material',
    variantes: [['M', 'Madera'], ['T', 'Metal'], ['P', 'Plástico'], ['X', 'Mixto']],
    subcategorias: [['S', 'Sillas'], ['M', 'Mesas'], ['C', 'Camas y colchones'], ['A', 'Armarios y cómodas'], ['E', 'Estanterías'], ['O', 'Otros']] },
  { letra: 'E', nombre: 'Escolar y papelería', antes: ['Papelería'], variante: 'Público',
    variantes: [['N', 'Niños'], ['J', 'Jóvenes'], ['A', 'Adultos'], ['U', 'General']],
    subcategorias: [['C', 'Cuadernos'], ['U', 'Útiles'], ['M', 'Morrales y maletas'], ['L', 'Libros'], ['P', 'Papelería y calendarios'], ['O', 'Otros']] },
  { letra: 'J', nombre: 'Juguetes y recreación', antes: ['Juguetes'], variante: 'Edad',
    variantes: [['B', 'Bebé'], ['N', 'Niño'], ['J', 'Joven'], ['U', 'General']],
    subcategorias: [['J', 'Juguetes'], ['M', 'Juegos de mesa'], ['D', 'Deportes'], ['O', 'Otros']] },
  { letra: 'K', nombre: 'Ayuda humanitaria (kits)', antes: [], variante: 'Alcance',
    variantes: [['I', 'Individual'], ['F', 'Familiar'], ['C', 'Comunitario']],
    subcategorias: [['A', 'Kit de aseo'], ['C', 'Kit de cocina'], ['H', 'Hamacas y carpas'], ['L', 'Linternas y energía'], ['O', 'Otros']] },
  { letra: 'O', nombre: 'Otros', antes: [], variante: 'Tipo', variantes: [['U', 'Único']], subcategorias: [['O', 'Otros']] }
];

// Crea lo que falte del árbol. Una categoría existente con el mismo nombre (o su nombre anterior) recibe la letra;
// si cambia de nombre, el texto de categoría de sus productos la sigue. Devuelve lo creado o actualizado.
async function crearArbol(tx, arbolDef = ARBOL_INICIAL) {
  const resultado = { categorias: [], subcategorias: 0, variantes: 0 };
  for (const def of arbolDef) {
    let cat = await tx.categoria.findFirst({ where: { letra: def.letra } });
    if (!cat) {
      for (const nombre of [def.nombre, ...def.antes]) {
        cat = await tx.categoria.findFirst({ where: { nombre: { equals: nombre, mode: 'insensitive' }, letra: null } });
        if (cat) break;
      }
      if (cat) {
        const nombreLibre = cat.nombre.toLowerCase() === def.nombre.toLowerCase() || !(await tx.categoria.findFirst({ where: { nombre: { equals: def.nombre, mode: 'insensitive' } } }));
        cat = await tx.categoria.update({ where: { id: cat.id }, data: { letra: def.letra, nombre_variante: def.variante, activo: true, ...(nombreLibre ? { nombre: def.nombre } : {}) } });
        if (nombreLibre) await tx.producto.updateMany({ where: { categoriaId: cat.id }, data: { categoria: def.nombre } });
      } else {
        cat = await tx.categoria.create({ data: { nombre: def.nombre, letra: def.letra, nombre_variante: def.variante } });
      }
      resultado.categorias.push(`${def.letra} ${cat.nombre}`);
    }
    const existentes = {
      subcategorias: new Set((await tx.subcategoria.findMany({ where: { categoriaId: cat.id }, select: { letra: true } })).map(x => x.letra)),
      variantes: new Set((await tx.variante.findMany({ where: { categoriaId: cat.id }, select: { letra: true } })).map(x => x.letra))
    };
    const subs = def.subcategorias.filter(([l]) => !existentes.subcategorias.has(l)).map(([letra, nombre]) => ({ categoriaId: cat.id, letra, nombre }));
    const vars = def.variantes.filter(([l]) => !existentes.variantes.has(l)).map(([letra, nombre]) => ({ categoriaId: cat.id, letra, nombre }));
    if (subs.length) await tx.subcategoria.createMany({ data: subs });
    if (vars.length) await tx.variante.createMany({ data: vars });
    resultado.subcategorias += subs.length;
    resultado.variantes += vars.length;
  }
  return resultado;
}

module.exports = {
  SUFIJO, PATRON, codigoHermano, siguienteCodigo, validarCodificacion, esCodificado,
  arbol, editarCategoriaCodigo, crearNivel, editarNivel, crearArbol, ARBOL_INICIAL
};
