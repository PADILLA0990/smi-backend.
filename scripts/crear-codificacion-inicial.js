// Carga el árbol de codificación propuesto en docs/CODIFICACION.md (letras, subcategorías y variantes).
// Solo crea lo que falta; renombra las categorías antiguas (Textiles → Ropa, etc.).
// Uso: node scripts/crear-codificacion-inicial.js            (muestra qué haría)
//      node scripts/crear-codificacion-inicial.js --aplicar  (lo aplica)
const prisma = require('../lib/prisma');
const { crearArbol, ARBOL_INICIAL } = require('../lib/codificacion');

(async () => {
  if (!process.argv.includes('--aplicar')) {
    const conLetra = new Set((await prisma.categoria.findMany({ where: { letra: { not: null } }, select: { letra: true } })).map(c => c.letra));
    const faltan = ARBOL_INICIAL.filter(c => !conLetra.has(c.letra));
    console.log('Categorías por codificar:', faltan.map(c => `${c.letra} ${c.nombre}${c.antes.length ? ` (antes: ${c.antes.join(', ')})` : ''}`).join(' · ') || 'ninguna');
    console.log('Ejecute con --aplicar para cargarlas.');
  } else {
    const r = await prisma.$transaction(tx => crearArbol(tx), { maxWait: 10000, timeout: 120000 });
    console.log('Categorías:', r.categorias.join(', ') || 'ninguna nueva', `· ${r.subcategorias} subcategorías · ${r.variantes} variantes`);
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
