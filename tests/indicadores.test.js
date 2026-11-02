// Pruebas unitarias de los indicadores (Fase F): funciones puras con datos fijos, sin base de datos.
const { test } = require('node:test');
const assert = require('node:assert');
const { calcular, periodo, catalogo } = require('../lib/indicadores');

const PARAMETROS = { tiempo_meta_alistamiento_horas: 24, dias_atraso_sbo: 0, lote_pequeno_max: 10, lote_mediano_max: 50 };
const item = (solicitada, alistada = solicitada, devuelta = 0) => ({ cantidad_solicitada: solicitada, cantidad_alistada: alistada, cantidad_devuelta: devuelta });
// Hora de Bogotá → UTC (+5 h)
const bog = (iso) => new Date(new Date(iso + 'Z').getTime() + 5 * 3600 * 1000);

const datos = {
  parametros: PARAMETROS,
  solicitudes: [
    // Noviembre: ana alista 2 SBO, luis 1; una sin alistador
    { codigo_sbo: 'S1', beneficiario: 'Org A', estado: 'DESPACHADA', alistador: 'ana', items: [item(5), item(3)],
      fecha_inicio_alistamiento: bog('2026-11-03T08:00:00'), fecha_fin_alistamiento: bog('2026-11-03T10:00:00'),
      fecha_despacho: bog('2026-11-04T23:30:00'), fecha_requerida: new Date('2026-11-04T00:00:00Z') },
    { codigo_sbo: 'S2', beneficiario: 'Org B', estado: 'DESPACHADA', alistador: 'ana', items: [item(60, 40, 5)],
      fecha_inicio_alistamiento: bog('2026-11-05T08:00:00'), fecha_fin_alistamiento: bog('2026-11-05T12:00:00'),
      fecha_despacho: bog('2026-11-07T09:00:00'), fecha_requerida: new Date('2026-11-06T00:00:00Z') },
    { codigo_sbo: 'S3', beneficiario: 'Org A', estado: 'ALISTADA', alistador: 'luis', items: [item(20)],
      fecha_inicio_alistamiento: bog('2026-11-10T08:00:00'), fecha_fin_alistamiento: bog('2026-11-10T09:00:00') },
    { codigo_sbo: 'S4', beneficiario: 'Org C', estado: 'DESPACHADA', alistador: null, items: [item(2)],
      fecha_fin_alistamiento: bog('2026-11-12T09:00:00'), fecha_despacho: bog('2026-11-12T10:00:00'), fecha_requerida: null },
    // Octubre (fuera del período de noviembre)
    { codigo_sbo: 'S5', beneficiario: 'Org A', estado: 'DESPACHADA', alistador: 'luis', items: [item(7)],
      fecha_inicio_alistamiento: bog('2026-10-20T08:00:00'), fecha_fin_alistamiento: bog('2026-10-31T23:00:00'), fecha_despacho: bog('2026-10-31T23:30:00') },
    { codigo_sbo: 'S6', beneficiario: 'Org C', estado: 'CANCELADA', items: [item(9, 0)], fecha_cancelacion: bog('2026-11-15T10:00:00') }
  ],
  productos: [
    { codigo_producto: 'P1', descripcion: 'Camisa', categoria: 'Ropa', cantidad: 10, activo: true, fecha_ingreso: bog('2026-11-01T08:00:00') },
    { codigo_producto: 'P2', descripcion: 'Olla', categoria: 'Cocina', cantidad: 4, activo: true, fecha_ingreso: bog('2026-05-01T08:00:00') },
    { codigo_producto: 'P3', descripcion: 'Saco', categoria: 'Ropa', cantidad: 6, activo: true, fecha_ingreso: bog('2024-01-01T08:00:00') },
    { codigo_producto: 'P4', descripcion: 'Agotado', categoria: 'Ropa', cantidad: 0, activo: true, fecha_ingreso: bog('2024-01-01T08:00:00') },
    { codigo_producto: 'P5', descripcion: 'Inactivo', categoria: 'Ropa', cantidad: 3, activo: false, fecha_ingreso: bog('2024-01-01T08:00:00') }
  ],
  historial: [
    { codigo_producto: 'P1', accion: 'INGRESO NUEVO', detalles: 'Ingresó cantidad: 12', operario: 'ana', fecha: bog('2026-11-01T08:00:00') },
    { codigo_producto: 'P1', accion: 'SALIDA/RETIRO', detalles: 'Retiro de 2 unidades', operario: 'luis', fecha: bog('2026-11-02T08:00:00') },
    { codigo_producto: 'P2', accion: 'INGRESO NUEVO', detalles: 'Ingresó cantidad: 4', operario: 'ana', fecha: bog('2026-05-01T08:00:00') },
    { codigo_producto: 'P3', accion: 'REUBICACIÓN', detalles: 'Movido a: Z1-A-1-01', operario: 'ana', fecha: bog('2026-10-31T23:59:00') },
    { codigo_producto: 'P3', accion: 'NOVEDAD', detalles: 'NOV-0001', operario: 'ana', fecha: bog('2026-11-20T08:00:00') },
    { codigo_producto: 'P1', accion: 'DEVOLUCIÓN SBO', detalles: 'Devolución de 5 unidades. SBO S2', operario: 'luis', fecha: bog('2026-11-08T08:00:00') },
    { codigo_producto: 'S1', accion: 'SBO VENCIDA', detalles: '', operario: 'SISTEMA', fecha: bog('2026-11-09T08:00:00') }
  ],
  novedades: [
    { tipo: 'FALTANTE', fecha: bog('2026-11-05T12:00:00'), motivo: null },
    { tipo: 'FALTANTE', fecha: bog('2026-11-06T12:00:00'), motivo: null },
    { tipo: 'DANADO', fecha: bog('2026-11-06T12:00:00'), motivo: { nombre: 'Humedad' } },
    { tipo: 'OTRO', fecha: bog('2026-10-06T12:00:00'), motivo: null }
  ]
};
const nov = periodo(2026, 11);
const ahora = bog('2026-11-30T12:00:00');
const valores = (r) => Object.fromEntries(r.datos.map(f => [f.etiqueta, f.valor]));

test('Período en hora de Bogotá: el 31/10 a las 11 p. m. no es de noviembre', () => {
  const r = calcular('sbo-por-alistador', datos, nov);
  assert.deepStrictEqual(valores(r), { ana: 2, luis: 1 });
  assert.strictEqual(r.excluidos.total, 1);
  assert.deepStrictEqual(r.excluidos.codigos, ['S4']);
  assert.strictEqual(periodo(2026).nombre, '2026');
  assert.throws(() => periodo(2026, 13), /Mes inválido/);
});

test('Unidades y tiempo promedio por alistador', () => {
  assert.deepStrictEqual(valores(calcular('unidades-por-alistador', datos, nov)), { ana: 48, luis: 20 });
  const t = calcular('tiempo-alistamiento', datos, nov);
  assert.deepStrictEqual(valores(t), { ana: 3, luis: 1 }); // ana: (2 h + 4 h) / 2
  assert.strictEqual(t.referencia.valor, 24);
});

test('Cumplimiento: hasta el final del día requerido (hora de Bogotá); sin fecha se excluye', () => {
  const r = calcular('cumplimiento', datos, nov);
  assert.deepStrictEqual(valores(r), { 'A tiempo': 1, Tarde: 1 }); // S1 a las 11:30 p. m. del día requerido; S2 un día tarde
  assert.strictEqual(r.destacado.valor, 50);
  assert.strictEqual(r.excluidos.total, 1);
  const tolerante = calcular('cumplimiento', { ...datos, parametros: { ...PARAMETROS, dias_atraso_sbo: 1 } }, nov);
  assert.strictEqual(valores(tolerante)['A tiempo'], 2);
});

test('Lotes según los parámetros', () => {
  const r = calcular('lotes', datos, nov);
  assert.deepStrictEqual(r.datos.map(f => f.valor), [2, 1, 0]); // S1 (8) y S4 (2) pequeños; S2 (40) mediano
});

test('Inventario: categorías, antigüedad y sin movimiento (solo activos con existencias)', () => {
  assert.deepStrictEqual(valores(calcular('unidades-por-categoria', datos, nov)), { Ropa: 16, Cocina: 4 });
  const a = calcular('antiguedad', datos, nov, { ahora });
  assert.deepStrictEqual(a.datos.map(f => f.valor), [10, 0, 0, 4, 6]); // P2: 213 días
  const s = calcular('sin-movimiento', datos, nov, { ahora, dias: 90 });
  // P3 se reubicó el 31/10 (la NOVEDAD no cuenta) → 30 días; P2 lleva 213 días
  assert.deepStrictEqual(s.datos.map(f => f.etiqueta), ['P2']);
  assert.strictEqual(calcular('sin-movimiento', datos, nov, { ahora, dias: 20 }).total, 3); // P1 (22 días), P3 (30) y P2
});

test('Entradas y salidas por mes del año (incluye devoluciones)', () => {
  const r = calcular('entradas-salidas', datos, nov);
  assert.strictEqual(r.datos.length, 12);
  assert.deepStrictEqual(r.datos[10], { etiqueta: 'Nov', entradas: 17, salidas: 2 });
  assert.deepStrictEqual(r.datos[4], { etiqueta: 'May', entradas: 4, salidas: 0 });
});

test('Operación: movimientos por operario, organizaciones, novedades y no entregadas', () => {
  const m = calcular('movimientos-por-operario', datos, nov);
  assert.deepStrictEqual(m.datos.map(f => f.etiqueta), ['ana', 'luis']); // SISTEMA no cuenta
  assert.deepStrictEqual(m.datos[1], { etiqueta: 'luis', ingresos: 1, salidas: 1, reubicaciones: 0, otros: 0 });
  assert.deepStrictEqual(valores(calcular('organizaciones', datos, nov)), { 'Org B': 35, 'Org A': 8, 'Org C': 2 });
  assert.deepStrictEqual(valores(calcular('novedades', datos, nov)), { Faltante: 2, 'Artículo dañado · Humedad': 1 });
  const ne = calcular('no-entregadas', datos, nov);
  assert.deepStrictEqual(ne.datos, [
    { etiqueta: 'Org B', parcial: 20, cancelada: 0, vencida: 0 },
    { etiqueta: 'Org C', parcial: 0, cancelada: 9, vencida: 0 }
  ]);
});

test('Catálogo con los 13 indicadores en 3 grupos', () => {
  const c = catalogo();
  assert.strictEqual(c.length, 13);
  assert.deepStrictEqual([...new Set(c.map(i => i.grupo))], ['Alistamiento', 'Inventario', 'Operación']);
  assert.throws(() => calcular('no-existe', datos, nov), /desconocido/);
});
