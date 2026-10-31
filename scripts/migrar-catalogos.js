// Pasa los textos libres existentes (categoría, estado, ubicación, beneficiario) a los catálogos de la Fase C.
// Por defecto SOLO muestra el mapeo. Para aplicarlo:
//   node scripts/migrar-catalogos.js --aplicar
// Solo llena campos nuevos (categoriaId, condicion, organizacionId) y crea entradas de catálogo faltantes:
// no cambia cantidades, ubicaciones, textos existentes ni historial anterior.
require('dotenv').config({ path: process.env.ARCHIVO_ENV || '.env' });
const prisma = require('../lib/prisma');
const { CONDICIONES } = require('../lib/catalogos');

const APLICAR = process.argv.includes('--aplicar');

const normalizar = (t) => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
// Variantes conocidas que se escriben distinto al nombre del catálogo
const SINONIMOS = { textil: 'textiles', ropa: 'textiles', papeleria: 'papeleria', utiles: 'papeleria', zapatos: 'calzado', juguete: 'juguetes', aseo: 'aseo no perecedero' };
const ESTADOS = {
  nuevo: 'PERFECTO', perfecto: 'PERFECTO', 'perfecto estado': 'PERFECTO',
  bueno: 'BUENO', 'buen estado': 'BUENO', usado: 'BUENO',
  deterioro: 'DETERIORO', 'en deterioro': 'DETERIORO', 'requiere arreglo': 'DETERIORO',
  danado: 'DANADO', descarte: 'DANADO'
};

(async () => {
  const [productos, categorias, ubicaciones, solicitudes, organizaciones] = await Promise.all([
    prisma.producto.findMany({ orderBy: { codigo_producto: 'asc' } }),
    prisma.categoria.findMany(),
    prisma.ubicacion.findMany(),
    prisma.solicitud.findMany({ where: { organizacionId: null } }),
    prisma.organizacion.findMany()
  ]);
  const catPorNombre = Object.fromEntries(categorias.map(c => [normalizar(c.nombre), c]));
  const ubicPorCodigo = Object.fromEntries(ubicaciones.map(u => [normalizar(u.codigo), u]));
  const orgPorNombre = Object.fromEntries(organizaciones.map(o => [normalizar(o.nombre), o]));

  console.log(`Base: ${process.env.DATABASE_URL.includes('smi_pruebas') ? 'PRUEBAS (smi_pruebas)' : 'PRODUCCIÓN'} · modo: ${APLICAR ? 'APLICAR' : 'solo mostrar'}\n`);
  const planProductos = [];
  const sinMapeo = [];
  for (const p of productos) {
    const clave = normalizar(p.categoria);
    const cat = p.categoriaId ? null : catPorNombre[SINONIMOS[clave] || clave];
    const condicion = p.condicion ? null : ESTADOS[normalizar(p.estado)];
    if (!p.categoriaId && !cat) sinMapeo.push(`${p.codigo_producto}: categoría "${p.categoria}" no está en el catálogo`);
    if (!p.condicion && p.estado && !condicion) sinMapeo.push(`${p.codigo_producto}: estado "${p.estado}" no corresponde a ninguna condición`);
    const data = {};
    if (cat) data.categoriaId = cat.id;
    if (condicion) data.condicion = condicion;
    if (Object.keys(data).length) planProductos.push({ p, data, cat });
  }

  const ubicacionesFaltantes = [...new Set(productos.map(p => p.codigo_estanteria || p.ubicacion_general))]
    .filter(c => !ubicPorCodigo[normalizar(c)]);
  const orgsFaltantes = [...new Set(solicitudes.map(s => s.beneficiario.trim()))].filter(n => !orgPorNombre[normalizar(n)]);

  console.log('Productos:');
  for (const { p, data, cat } of planProductos) {
    const partes = [];
    if (cat) partes.push(`categoría "${p.categoria}" → ${cat.nombre} (id ${cat.id})`);
    if (data.condicion) partes.push(`estado "${p.estado}" → condición ${CONDICIONES[data.condicion]}`);
    console.log(`  ${p.codigo_producto}: ${partes.join('; ')}`);
  }
  if (!planProductos.length) console.log('  (nada que mapear)');
  console.log('Ubicaciones a crear en el catálogo:', ubicacionesFaltantes.length ? ubicacionesFaltantes.join(', ') : '(ninguna)');
  console.log('Organizaciones a crear desde SBO existentes:', orgsFaltantes.length ? orgsFaltantes.join(', ') : '(ninguna)');
  if (sinMapeo.length) console.log('\nPendientes de decisión:\n  ' + sinMapeo.join('\n  '));

  if (!APLICAR) {
    console.log('\nNo se aplicó nada. Revise el mapeo y repita con --aplicar.');
    return prisma.$disconnect();
  }
  if (sinMapeo.length) throw new Error('Hay pendientes de decisión: no se aplicó nada.');

  await prisma.$transaction(async (tx) => {
    for (const codigo of ubicacionesFaltantes) await tx.ubicacion.create({ data: { codigo } });
    for (const nombre of orgsFaltantes) await tx.organizacion.create({ data: { nombre } });
    const orgs = await tx.organizacion.findMany();
    for (const s of solicitudes) {
      const org = orgs.find(o => normalizar(o.nombre) === normalizar(s.beneficiario));
      await tx.solicitud.update({ where: { id: s.id }, data: { organizacionId: org.id } });
    }
    for (const { p, data } of planProductos) {
      await tx.producto.update({ where: { id: p.id }, data });
      await tx.historial.create({
        data: {
          codigo_producto: p.codigo_producto, accion: 'EDICIÓN', operario: 'sistema',
          detalles: 'Migración a catálogos (Fase C): ' + Object.entries(data).map(([k, v]) => (k === 'categoriaId' ? `categoría enlazada a ${p.categoria}` : `condición: ${CONDICIONES[v]}`)).join('; ')
        }
      });
    }
  }, { maxWait: 10000, timeout: 30000 });
  console.log('\nMapeo aplicado.');
  await prisma.$disconnect();
})().catch(async e => { console.error('Error:', e.message); await prisma.$disconnect(); process.exit(1); });
