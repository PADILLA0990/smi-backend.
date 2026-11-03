// Deja todas las estanterías activas con el mismo número de niveles (03/11/2026: todos los racks de 3 niveles).
// Los huecos de los niveles que sobran se desactivan; si alguno tiene producto no se guarda nada y se dice qué reubicar.
// Uso: node scripts/niveles-racks.js 3            (muestra qué haría, sin guardar)
//      node scripts/niveles-racks.js 3 --aplicar  (guarda)
const prisma = require('../lib/prisma');
const { editarEstanteria } = require('../lib/estanterias');

const SIMULACION = 'simulación: no se guarda';
const aplicar = process.argv.includes('--aplicar');
const niveles = Number(process.argv.find(a => /^\d+$/.test(a)));

(async () => {
  if (!Number.isInteger(niveles) || niveles < 1 || niveles > 6) throw new Error('Indique los niveles (1 a 6). Ej.: node scripts/niveles-racks.js 3');
  const cambios = [];
  try {
    await prisma.$transaction(async (tx) => {
      const racks = await tx.estanteria.findMany({ where: { activo: true }, orderBy: [{ zona: 'asc' }, { orden: 'asc' }] });
      for (const e of racks) {
        if (e.niveles === niveles) continue;
        await editarEstanteria(tx, e.id, { niveles });
        cambios.push(`${e.codigo} (${e.niveles} → ${niveles})`);
      }
      if (!aplicar) throw new Error(SIMULACION);
    }, { maxWait: 10000, timeout: 180000 });
  } catch (e) {
    if (e.message !== SIMULACION) throw e;
  }
  console.log(aplicar ? 'Aplicado:' : 'Cambios que haría (ejecute con --aplicar para guardarlos):');
  console.log('  Racks:', cambios.join(', ') || 'ninguno');
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
