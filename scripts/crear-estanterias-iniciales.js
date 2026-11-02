// Carga la distribución inicial del Mapa de Bodega (racks A–J y áreas). Solo crea lo que falta.
// Uso: node scripts/crear-estanterias-iniciales.js            (muestra qué crearía)
//      node scripts/crear-estanterias-iniciales.js --aplicar  (crea)
const prisma = require('../lib/prisma');
const { crearDistribucionInicial, DISTRIBUCION_INICIAL } = require('../lib/estanterias');

(async () => {
  if (!process.argv.includes('--aplicar')) {
    const existentes = new Set((await prisma.estanteria.findMany({ select: { codigo: true } })).map(e => e.codigo));
    const faltan = DISTRIBUCION_INICIAL.estanterias.filter(e => !existentes.has(`${e.zona}-${e.rack}`));
    console.log('Estanterías por crear:', faltan.map(e => `${e.zona}-${e.rack} (${e.niveles}×${e.huecos})`).join(', ') || 'ninguna');
    console.log('Huecos por crear:', faltan.reduce((s, e) => s + e.niveles * e.huecos, 0));
    console.log('Ejecute con --aplicar para crearlas.');
  } else {
    const creado = await prisma.$transaction(tx => crearDistribucionInicial(tx), { maxWait: 10000, timeout: 120000 });
    console.log('Creadas:', creado.estanterias.join(', ') || 'ninguna', '· Áreas:', creado.areas.join(', ') || 'ninguna');
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
