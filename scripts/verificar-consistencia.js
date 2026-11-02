// Verificación de consistencia entre Historial e Inventario (SOLO LECTURA).
//
// Recalcula el stock, la ubicación y las reservas de cada producto a partir de
// los movimientos registrados y lo compara con lo guardado en la tabla Producto.
// No modifica nada: sirve de diagnóstico y será la base del reporte de Conciliación.
//
// Uso:
//   node scripts/verificar-consistencia.js                 (lee la BD de DATABASE_URL con Prisma)
//   SMI_TOKEN=<token> node scripts/verificar-consistencia.js --api <URL>   (lee por la API, solo GET;
//                                          desde la Fase B la API exige un token de acceso)
//   node scripts/verificar-consistencia.js --json          (salida en JSON)
// Sale con código 1 si encuentra diferencias.

const ESTADOS_CON_RESERVA = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADA'];
// Acciones que no mueven stock ni ubicación (NOVEDAD: Fase E, informativa)
const SIN_EFECTO = ['EDICIÓN', 'INACTIVACIÓN', 'ACTIVACIÓN', 'NOVEDAD'];

const numero = (texto, regex) => {
  const m = texto && texto.match(regex);
  return m ? Number(m[1]) : null;
};

// Aplica cada movimiento del historial, en orden cronológico, y devuelve el estado esperado por código.
// Cada movimiento queda con el saldo resultante (lo usa el kardex).
// zonas: { codigo de ubicación en minúsculas: zona } del catálogo; al reubicar, ubicacion_general = zona o "Almacenamiento".
function recalcular(historial, zonas = {}) {
  const esperado = {};
  const ordenado = [...historial].sort((a, b) => new Date(a.fecha) - new Date(b.fecha) || a.id - b.id);

  for (const mov of ordenado) {
    const codigo = mov.codigo_producto;
    const p = esperado[codigo] || (esperado[codigo] = {
      existe: false, agotado: false, cantidad: 0, ubicacion_general: null, codigo_estanteria: null, movimientos: [], avisos: []
    });
    const d = mov.detalles || '';

    switch (mov.accion) {
      case 'INGRESO NUEVO': {
        const n = numero(d, /cantidad:\s*(\d+)/i);
        if (n === null) { p.avisos.push(`#${mov.id} INGRESO NUEVO sin cantidad legible`); break; }
        if (p.existe && !p.agotado) p.avisos.push(`#${mov.id} INGRESO NUEVO sobre un producto que ya existía`);
        // Desde la Fase D2 el detalle termina en "Ubicación inicial: X" cuando no es Recepción
        const inicial = (d.match(/Ubicación inicial:\s*(.+)$/i) || [])[1];
        Object.assign(p, { existe: true, agotado: false, cantidad: n, ubicacion_general: inicial ? inicial.trim() : 'Recepción', codigo_estanteria: null });
        break;
      }
      case 'INGRESO ADICIONAL': {
        const n = numero(d, /cantidad:\s*(\d+)/i);
        if (n === null) { p.avisos.push(`#${mov.id} INGRESO ADICIONAL sin cantidad legible`); break; }
        if (!p.existe && !p.agotado) p.avisos.push(`#${mov.id} INGRESO ADICIONAL sobre un producto que no existía`);
        p.existe = true;
        p.agotado = false;
        p.cantidad += n;
        break;
      }
      case 'DEVOLUCIÓN SBO': {
        // Fase E: unidades despachadas que vuelven al stock
        const n = numero(d, /Devolución de (\d+)/i);
        if (n === null) { p.avisos.push(`#${mov.id} DEVOLUCIÓN SBO sin cantidad legible`); break; }
        if (!p.existe && !p.agotado) p.avisos.push(`#${mov.id} DEVOLUCIÓN SBO sobre un producto que no existía`);
        p.existe = true;
        p.agotado = false;
        p.cantidad += n;
        break;
      }
      case 'AJUSTE': {
        // Fase G: diferencia aprobada de un conteo físico ("Ajuste de +3" / "Ajuste de -2")
        const n = numero(d, /Ajuste de ([+-]?\d+)/i);
        if (n === null) { p.avisos.push(`#${mov.id} AJUSTE sin cantidad legible`); break; }
        p.cantidad += n;
        if (p.cantidad < 0) p.avisos.push(`#${mov.id} el saldo queda negativo (${p.cantidad})`);
        if (p.cantidad > 0) { p.existe = true; p.agotado = false; } else { p.existe = false; p.agotado = true; }
        break;
      }
      case 'SALIDA/RETIRO':
      case 'SALIDA SBO': {
        const n = numero(d, /(?:Retiro|Despacho) de (\d+)/i);
        if (n === null) { p.avisos.push(`#${mov.id} ${mov.accion} sin cantidad legible`); break; }
        if (!p.existe) p.avisos.push(`#${mov.id} ${mov.accion} sobre un producto que no existía`);
        p.cantidad -= n;
        if (p.cantidad < 0) p.avisos.push(`#${mov.id} el saldo queda negativo (${p.cantidad})`);
        // Antes de la Fase D el producto se eliminaba al llegar a 0; desde entonces se conserva con 0.
        // "agotado" acepta los dos casos.
        if (p.cantidad <= 0) { p.existe = false; p.agotado = true; }
        break;
      }
      case 'REUBICACIÓN': {
        const destino = (d.match(/Movido a:\s*(.+)$/i) || [])[1];
        if (!p.existe) p.avisos.push(`#${mov.id} REUBICACIÓN sobre un producto que no existía`);
        p.codigo_estanteria = destino ? destino.trim() : null;
        p.ubicacion_general = zonas[(p.codigo_estanteria || '').toLowerCase()] || 'Almacenamiento';
        break;
      }
      case 'ELIMINACIÓN':
        p.existe = false;
        p.agotado = false;
        p.cantidad = 0;
        break;
      default:
        // Eventos SBO (CREADA, APROBADA, ...) no mueven stock: la reserva se valida con las solicitudes
        if (!mov.accion.startsWith('SBO ') && !SIN_EFECTO.includes(mov.accion)) p.avisos.push(`#${mov.id} acción desconocida "${mov.accion}"`);
    }
    p.movimientos.push({ ...mov, saldo: p.cantidad });
  }
  return esperado;
}

// Reservas esperadas: suma de lo solicitado en SBO aprobadas que aún no se despachan
function reservasEsperadas(solicitudes) {
  const reservas = {};
  for (const s of solicitudes) {
    if (!ESTADOS_CON_RESERVA.includes(s.estado)) continue;
    for (const item of s.items || []) {
      reservas[item.codigo_producto] = (reservas[item.codigo_producto] || 0) + item.cantidad_solicitada;
    }
  }
  return reservas;
}

// Compara lo recalculado con lo guardado. Devuelve una lista de diferencias por producto.
// Mapa de zonas por código de ubicación, para recalcular()
const zonasDe = (ubicaciones = []) =>
  Object.fromEntries(ubicaciones.filter(u => u.zona).map(u => [u.codigo.toLowerCase(), u.zona]));

function compararConsistencia({ productos, historial, solicitudes = [], ubicaciones = [] }) {
  const esperado = recalcular(historial, zonasDe(ubicaciones));
  const reservas = reservasEsperadas(solicitudes);
  const guardados = Object.fromEntries(productos.map(p => [p.codigo_producto, p]));
  const codigos = [...new Set([...Object.keys(esperado), ...Object.keys(guardados)])].sort();
  const resultado = [];

  for (const codigo of codigos) {
    const e = esperado[codigo];
    const g = guardados[codigo];
    const diferencias = [];

    if (!e) {
      diferencias.push({ campo: 'historial', esperado: 'con movimientos', guardado: 'sin ningún movimiento' });
    } else if (e.existe && !g) {
      diferencias.push({ campo: 'existencia', esperado: `existe con ${e.cantidad}`, guardado: 'no existe' });
    } else if (!e.existe && g && !(e.agotado && g.cantidad === 0)) {
      diferencias.push({ campo: 'existencia', esperado: 'no existe (eliminado o agotado)', guardado: `existe con ${g.cantidad}` });
    } else if (e.existe && g) {
      if (e.cantidad !== g.cantidad) diferencias.push({ campo: 'cantidad', esperado: e.cantidad, guardado: g.cantidad });
      if (e.ubicacion_general !== g.ubicacion_general) diferencias.push({ campo: 'ubicacion_general', esperado: e.ubicacion_general, guardado: g.ubicacion_general });
      if ((e.codigo_estanteria || null) !== (g.codigo_estanteria || null)) diferencias.push({ campo: 'codigo_estanteria', esperado: e.codigo_estanteria, guardado: g.codigo_estanteria });
    }
    if (g && (reservas[codigo] || 0) !== (g.cantidad_reservada || 0)) {
      diferencias.push({ campo: 'cantidad_reservada', esperado: reservas[codigo] || 0, guardado: g.cantidad_reservada || 0 });
    }

    resultado.push({ codigo_producto: codigo, ok: diferencias.length === 0, diferencias, avisos: e ? e.avisos : [], movimientos: e ? e.movimientos : [] });
  }
  return resultado;
}

// ---------- Lectura de datos (solo consultas) ----------

async function leerPorApi(base) {
  const url = base.replace(/\/+$/, '') + (base.endsWith('/api') ? '' : '/api');
  const get = async (ruta) => {
    const r = await fetch(url + ruta, { headers: process.env.SMI_TOKEN ? { Authorization: `Bearer ${process.env.SMI_TOKEN}` } : {} });
    if (!r.ok) throw new Error(`GET ${ruta} respondió ${r.status}`);
    return r.json();
  };
  const [productos, historial, lista, ubicaciones] = await Promise.all([get('/productos'), get('/historial'), get('/solicitudes'), get('/ubicaciones?todas=1')]);
  // Las solicitudes con reserva se piden con detalle para tener sus ítems
  const solicitudes = await Promise.all(lista.map(s =>
    ESTADOS_CON_RESERVA.includes(s.estado) && !s.items ? get(`/solicitudes/${s.id}`) : s));
  return { productos, historial, solicitudes, ubicaciones };
}

async function leerPorPrisma() {
  require('dotenv').config();
  const prisma = require('../lib/prisma');
  try {
    const [productos, historial, solicitudes, ubicaciones] = await Promise.all([
      prisma.producto.findMany(),
      prisma.historial.findMany(),
      prisma.solicitud.findMany({ include: { items: true } }),
      prisma.ubicacion.findMany()
    ]);
    return { productos, historial, solicitudes, ubicaciones };
  } finally {
    await prisma.$disconnect();
  }
}

function imprimir(resultado) {
  const fecha = (f) => new Date(f).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true });
  const conDiferencias = resultado.filter(r => !r.ok);
  console.log(`Productos revisados: ${resultado.length} · con diferencias: ${conDiferencias.length}\n`);

  for (const r of resultado) {
    console.log(`${r.ok ? '✔' : '✖'} ${r.codigo_producto}`);
    for (const d of r.diferencias) console.log(`    ${d.campo}: esperado ${JSON.stringify(d.esperado)} · guardado ${JSON.stringify(d.guardado)}`);
    for (const a of r.avisos) console.log(`    aviso: ${a}`);
    if (!r.ok) {
      console.log('    movimientos:');
      for (const m of r.movimientos) console.log(`      #${m.id} ${fecha(m.fecha)}  ${m.accion.padEnd(17)} ${m.operario}  ${m.detalles || ''}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const iApi = args.indexOf('--api');
  const datos = iApi >= 0 ? await leerPorApi(args[iApi + 1]) : await leerPorPrisma();
  const resultado = compararConsistencia(datos);

  if (args.includes('--json')) console.log(JSON.stringify(resultado.map(({ movimientos, ...r }) => r), null, 2));
  else imprimir(resultado);
  process.exitCode = resultado.some(r => !r.ok) ? 1 : 0;
}

if (require.main === module) {
  main().catch(err => { console.error('Error:', err.message); process.exitCode = 2; });
}

module.exports = { recalcular, reservasEsperadas, compararConsistencia, zonasDe };
