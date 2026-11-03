// Completa una bodega ya cargada con la distribución de lib/estanterias.js: huecos de los niveles superiores
// (Zona 1: uno más del nivel 2 hacia arriba), posición de los racks en el plano y el plano de cada zona.
// No cambia lo que ya esté configurado.
// Uso: node scripts/completar-plano-bodega.js            (muestra qué haría, sin guardar)
//      node scripts/completar-plano-bodega.js --aplicar  (guarda)
const prisma = require('../lib/prisma');
const { completarPlano } = require('../lib/estanterias');

const SIMULACION = 'simulación: no se guarda';
const aplicar = process.argv.includes('--aplicar');

(async () => {
  let cambios;
  try {
    await prisma.$transaction(async (tx) => {
      cambios = await completarPlano(tx);
      if (!aplicar) throw new Error(SIMULACION);
    }, { maxWait: 10000, timeout: 120000 });
  } catch (e) {
    if (e.message !== SIMULACION) throw e;
  }
  console.log(aplicar ? 'Aplicado:' : 'Cambios que haría (ejecute con --aplicar para guardarlos):');
  console.log('  Racks:', cambios.racks.join(', ') || 'ninguno');
  console.log('  Elementos del plano nuevos:', cambios.elementos);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
