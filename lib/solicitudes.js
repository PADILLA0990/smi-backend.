// Solicitudes SBO (Fase D3): numeración, campos calculados, lista con filtros y vencimiento.
const { leerParametros } = require('./catalogos');
const { leerPaginacion, filtroFechas } = require('./inventario');
const { liberarReserva } = require('./stock');
const { registrarHistorial } = require('./historial');
const { ACTIVOS } = require('../solicitudes/estados');
const { StockError } = require('./stock');

// Estados en los que la solicitud tiene stock reservado
const ESTADOS_CON_RESERVA = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADA'];
const OPCIONES_TX = { maxWait: 10000, timeout: 20000 };
const DIA = 24 * 60 * 60 * 1000;
const PREFIJO = 'SBO-';
const SISTEMA = { usuario: 'sistema', id: null };

const minutosEntre = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 60000) : null);
// Fecha calendario (AAAA-MM-DD) en Bogotá
const diaBogota = (fecha) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(fecha);
const sumarDias = (aaaammdd, dias) => {
  const d = new Date(`${aaaammdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

// --- Numeración: SBO-0001, SBO-0002… (los códigos escritos a mano con otro formato no cuentan) ---
async function siguienteCodigo(tx) {
  const filas = await tx.solicitud.findMany({ where: { codigo_sbo: { startsWith: PREFIJO } }, select: { codigo_sbo: true } });
  let mayor = 0;
  for (const { codigo_sbo } of filas) {
    const m = codigo_sbo.match(/^SBO-(\d+)$/);
    if (m) mayor = Math.max(mayor, Number(m[1]));
  }
  return `${PREFIJO}${String(mayor + 1).padStart(4, '0')}`;
}

// Último movimiento: el evento más reciente (cambio de estado o renovación)
const ultimoMovimiento = (s) => (s.eventos || []).reduce((max, ev) => (new Date(ev.fecha) > max ? new Date(ev.fecha) : max), new Date(s.fecha_solicitud));

// Campos calculados que usa el frontend: atrasada, vencimiento, tiempos y referencia de cada línea
function describirSolicitud(s, parametros, ahora = new Date()) {
  const activa = ACTIVOS.includes(s.estado);
  const ultimo = ultimoMovimiento(s);
  const venceEl = new Date(ultimo.getTime() + parametros.dias_vencimiento_sbo * DIA);
  const diasParaVencer = Math.ceil((venceEl - ahora) / DIA);
  const limiteRequerida = s.fecha_requerida ? sumarDias(new Date(s.fecha_requerida).toISOString().slice(0, 10), parametros.dias_atraso_sbo) : null;
  const alistamiento = minutosEntre(s.fecha_inicio_alistamiento, s.fecha_fin_alistamiento);

  // Referencia por línea: SBO-0001-<código>; si el mismo producto se repite, -2, -3…
  const vistos = {};
  const items = (s.items || []).map(item => {
    vistos[item.codigo_producto] = (vistos[item.codigo_producto] || 0) + 1;
    const n = vistos[item.codigo_producto];
    return {
      ...item,
      referencia: `${s.codigo_sbo}-${item.codigo_producto}${n > 1 ? `-${n}` : ''}`,
      cantidad_reservada: ESTADOS_CON_RESERVA.includes(s.estado) ? item.cantidad_solicitada : 0,
      cantidad_despachada: s.estado === 'DESPACHADA' ? item.cantidad_alistada : 0
    };
  });

  return {
    ...s,
    items,
    activa,
    unidades_solicitadas: items.reduce((t, i) => t + i.cantidad_solicitada, 0),
    ultimo_movimiento: ultimo,
    dias_sin_movimiento: Math.max(0, Math.floor((ahora - ultimo) / DIA)),
    vence_el: activa ? venceEl : null,
    dias_para_vencer: activa ? diasParaVencer : null,
    por_vencer: activa && diasParaVencer <= parametros.dias_aviso_vencimiento_sbo,
    atrasada: activa && limiteRequerida !== null && diaBogota(ahora) > limiteRequerida,
    tiempos: {
      espera_aprobacion_min: minutosEntre(s.fecha_solicitud, s.fecha_aprobacion),
      alistamiento_min: alistamiento,
      total_min: minutosEntre(s.fecha_solicitud, s.fecha_despacho),
      meta_alistamiento_min: parametros.tiempo_meta_alistamiento_horas * 60,
      excede_meta: alistamiento !== null && alistamiento > parametros.tiempo_meta_alistamiento_horas * 60
    }
  };
}

const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const siNo = (v) => v === '1' || v === 'true';

// Lista paginada con filtros. Los filtros calculados (atrasada, por vencer) se resuelven en memoria.
async function listarSolicitudes(prisma, query) {
  const { pagina, porPagina } = leerPaginacion(query, 20);
  const and = filtroFechas(query).map(c => ({ fecha_solicitud: c.fecha }));
  const estado = texto(query.estado);
  if (estado === 'ACTIVAS') and.push({ estado: { in: ACTIVOS } });
  else if (estado) and.push({ estado });
  if (texto(query.organizacionId)) {
    if (!/^\d+$/.test(query.organizacionId)) throw new StockError(400, 'Organización inválida.');
    and.push({ organizacionId: Number(query.organizacionId) });
  }
  if (texto(query.alistador)) and.push({ alistador: { equals: texto(query.alistador), mode: 'insensitive' } });
  const q = texto(query.q);
  if (q) {
    const contiene = { contains: q, mode: 'insensitive' };
    and.push({ OR: [{ codigo_sbo: contiene }, { beneficiario: contiene }, { items: { some: { OR: [{ codigo_producto: contiene }, { descripcion: contiene }] } } }] });
  }

  const [filas, parametros] = await Promise.all([
    prisma.solicitud.findMany({ where: { AND: and }, include: { items: true, eventos: { select: { fecha: true } } }, orderBy: [{ fecha_solicitud: 'desc' }, { id: 'desc' }] }),
    leerParametros(prisma)
  ]);
  const ahora = new Date();
  let todas = filas.map(s => describirSolicitud(s, parametros, ahora));
  if (siNo(query.atrasada)) todas = todas.filter(s => s.atrasada);
  if (siNo(query.porVencer)) todas = todas.filter(s => s.por_vencer);
  const resumen = { atrasadas: todas.filter(s => s.atrasada).length, por_vencer: todas.filter(s => s.por_vencer).length };

  const datos = todas.slice((pagina - 1) * porPagina, pagina * porPagina).map(({ eventos, ...s }) => s);
  return { datos, total: todas.length, pagina, porPagina, resumen };
}

// --- Vencimiento automático ---
// Vence en su propia transacción una solicitud activa sin movimiento: libera la reserva y deja el rastro.
async function vencerSolicitud(prisma, s, dias) {
  await prisma.$transaction(async (tx) => {
    if (ESTADOS_CON_RESERVA.includes(s.estado)) {
      const totales = {};
      for (const item of s.items) totales[item.codigo_producto] = (totales[item.codigo_producto] || 0) + item.cantidad_solicitada;
      for (const [codigo, cantidad] of Object.entries(totales)) await liberarReserva(tx, codigo, cantidad);
    }
    // Condicionado al estado leído: si alguien la movió mientras tanto, no se vence
    const { count } = await tx.solicitud.updateMany({ where: { id: s.id, estado: s.estado }, data: { estado: 'VENCIDA', fecha_vencimiento: new Date() } });
    if (count === 0) throw new StockError(409, 'La solicitud cambió mientras se vencía.');
    const nota = `Vencida por ${dias} días sin movimiento`;
    await tx.solicitudEvento.create({ data: { solicitudId: s.id, estado_anterior: s.estado, estado_nuevo: 'VENCIDA', usuario: SISTEMA.usuario, nota } });
    await registrarHistorial(tx, s.codigo_sbo, 'SBO VENCIDA', SISTEMA, `${nota}${ESTADOS_CON_RESERVA.includes(s.estado) ? '; se liberó la reserva' : ''}`);
  }, OPCIONES_TX);
}

async function vencerSinMovimiento(prisma, ahora = new Date()) {
  const { dias_vencimiento_sbo: dias } = await leerParametros(prisma);
  const activas = await prisma.solicitud.findMany({ where: { estado: { in: ACTIVOS } }, include: { items: true, eventos: { select: { fecha: true } } } });
  const vencidas = [];
  for (const s of activas) {
    if (ahora - ultimoMovimiento(s) < dias * DIA) continue;
    try {
      await vencerSolicitud(prisma, s, dias);
      vencidas.push(s.codigo_sbo);
    } catch (error) {
      if (!(error instanceof StockError && error.status === 409)) throw error;
    }
  }
  return vencidas;
}

// Revisión con freno: como mucho una vez cada SBO_REVISION_MS (5 min por defecto) y nunca dos a la vez.
// La llaman el arranque del servidor, un temporizador horario y las consultas de solicitudes.
let ultimaRevision = 0;
let enCurso = null;
function revisarVencimientos(prisma) {
  const intervalo = Number(process.env.SBO_REVISION_MS ?? 5 * 60 * 1000);
  if (enCurso) return enCurso;
  if (Date.now() - ultimaRevision < intervalo) return Promise.resolve([]);
  ultimaRevision = Date.now();
  enCurso = vencerSinMovimiento(prisma)
    .then(vencidas => {
      if (vencidas.length) console.log(`SBO vencidas por falta de movimiento: ${vencidas.join(', ')}`);
      return vencidas;
    })
    .catch(error => {
      console.error('No se pudo revisar el vencimiento de las SBO:', error.message);
      return [];
    })
    .finally(() => { enCurso = null; });
  return enCurso;
}

module.exports = {
  ESTADOS_CON_RESERVA, siguienteCodigo, describirSolicitud, listarSolicitudes, vencerSinMovimiento, revisarVencimientos
};
