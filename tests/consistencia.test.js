// Pruebas unitarias del verificador de consistencia (no usan base de datos)
const { test } = require('node:test');
const assert = require('node:assert');
const { compararConsistencia } = require('../scripts/verificar-consistencia');

const mov = (id, codigo_producto, accion, detalles, fecha = `2026-10-01T00:00:${String(id).padStart(2, '0')}Z`) =>
  ({ id, codigo_producto, accion, detalles, operario: 'QA', fecha });

test('Producto consistente: ingresos, salida y reubicación', () => {
  const historial = [
    mov(1, 'A', 'INGRESO NUEVO', 'Ingresó cantidad: 10'),
    mov(2, 'A', 'INGRESO ADICIONAL', 'Ingresó cantidad: 5. Stock total: 15'),
    mov(3, 'A', 'SALIDA/RETIRO', 'Retiro de 4 unidades. Motivo: X'),
    mov(4, 'A', 'REUBICACIÓN', 'Movido a: AA02')
  ];
  const productos = [{ codigo_producto: 'A', cantidad: 11, cantidad_reservada: 0, ubicacion_general: 'Almacenamiento', codigo_estanteria: 'AA02' }];
  const [r] = compararConsistencia({ productos, historial });
  assert.ok(r.ok, JSON.stringify(r.diferencias));
});

test('Detecta salida registrada que no descontó stock y reubicación no aplicada (caso ROP-005)', () => {
  const historial = [
    mov(1, 'ROP-005', 'INGRESO NUEVO', 'Ingresó cantidad: 25'),
    mov(2, 'ROP-005', 'SALIDA/RETIRO', 'Retiro de 20 unidades. Motivo: DONACIÓN'),
    mov(3, 'ROP-005', 'REUBICACIÓN', 'Movido a: AA02')
  ];
  const productos = [{ codigo_producto: 'ROP-005', cantidad: 25, cantidad_reservada: 0, ubicacion_general: 'Recepción', codigo_estanteria: null }];
  const [r] = compararConsistencia({ productos, historial });
  assert.deepStrictEqual(r.diferencias.map(d => d.campo), ['cantidad', 'ubicacion_general', 'codigo_estanteria']);
  assert.strictEqual(r.diferencias[0].esperado, 5);
});

test('Producto agotado por SBO se espera eliminado y la reserva se valida con las solicitudes', () => {
  const historial = [
    mov(1, 'B', 'INGRESO NUEVO', 'Ingresó cantidad: 3'),
    mov(2, 'B', 'SALIDA SBO', 'Despacho de 3 unidades. SBO X → Y'),
    mov(3, 'C', 'INGRESO NUEVO', 'Ingresó cantidad: 10'),
    mov(4, 'C', 'SBO APROBADA', 'CREADA → APROBADA')
  ];
  const productos = [{ codigo_producto: 'C', cantidad: 10, cantidad_reservada: 2, ubicacion_general: 'Recepción', codigo_estanteria: null }];
  const solicitudes = [{ estado: 'APROBADA', items: [{ codigo_producto: 'C', cantidad_solicitada: 4 }] }];
  const res = compararConsistencia({ productos, historial, solicitudes });
  assert.ok(res.find(x => x.codigo_producto === 'B').ok);
  const c = res.find(x => x.codigo_producto === 'C');
  assert.deepStrictEqual(c.diferencias, [{ campo: 'cantidad_reservada', esperado: 4, guardado: 2 }]);
});

test('Producto guardado sin movimientos se reporta', () => {
  const productos = [{ codigo_producto: 'Z', cantidad: 1, cantidad_reservada: 0, ubicacion_general: 'Recepción', codigo_estanteria: null }];
  const [r] = compararConsistencia({ productos, historial: [] });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.diferencias[0].campo, 'historial');
});

test('Fase D: producto agotado que se conserva con 0 unidades es consistente y luego puede reingresar', () => {
  const historial = [
    mov(1, 'D', 'INGRESO NUEVO', 'Ingresó cantidad: 4'),
    mov(2, 'D', 'SALIDA/RETIRO', 'Retiro de 4 unidades. Motivo: X'),
    mov(3, 'E', 'INGRESO NUEVO', 'Ingresó cantidad: 2'),
    mov(4, 'E', 'SALIDA/RETIRO', 'Retiro de 2 unidades. Motivo: X'),
    mov(5, 'E', 'INGRESO ADICIONAL', 'Ingresó cantidad: 7. Stock total: 7')
  ];
  const productos = [
    { codigo_producto: 'D', cantidad: 0, cantidad_reservada: 0, ubicacion_general: 'Recepción', codigo_estanteria: null },
    { codigo_producto: 'E', cantidad: 7, cantidad_reservada: 0, ubicacion_general: 'Recepción', codigo_estanteria: null }
  ];
  const res = compararConsistencia({ productos, historial });
  assert.ok(res.every(r => r.ok && r.avisos.length === 0), JSON.stringify(res.map(r => [r.diferencias, r.avisos])));
});

test('Fase D: edición, inactivación y activación no mueven stock ni generan avisos', () => {
  const historial = [
    mov(1, 'F', 'INGRESO NUEVO', 'Ingresó cantidad: 3'),
    mov(2, 'F', 'EDICIÓN', 'talla: vacío → M'),
    mov(3, 'F', 'INACTIVACIÓN', 'Justificación: descontinuado'),
    mov(4, 'F', 'ACTIVACIÓN', 'Justificación: vuelve a recibirse')
  ];
  const productos = [{ codigo_producto: 'F', cantidad: 3, cantidad_reservada: 0, ubicacion_general: 'Recepción', codigo_estanteria: null }];
  const [r] = compararConsistencia({ productos, historial });
  assert.ok(r.ok && r.avisos.length === 0, JSON.stringify([r.diferencias, r.avisos]));
});

test('Fase D: la reubicación espera la zona del catálogo y cada movimiento lleva su saldo', () => {
  const historial = [
    mov(1, 'G', 'INGRESO NUEVO', 'Ingresó cantidad: 10'),
    mov(2, 'G', 'SALIDA/RETIRO', 'Retiro de 3 unidades. Motivo: X'),
    mov(3, 'G', 'REUBICACIÓN', 'Movido a: B-01')
  ];
  const productos = [{ codigo_producto: 'G', cantidad: 7, cantidad_reservada: 0, ubicacion_general: 'Bodega B', codigo_estanteria: 'B-01' }];
  const [r] = compararConsistencia({ productos, historial, ubicaciones: [{ codigo: 'B-01', zona: 'Bodega B' }] });
  assert.ok(r.ok, JSON.stringify(r.diferencias));
  assert.deepStrictEqual(r.movimientos.map(m => m.saldo), [10, 7, 7]);
});
