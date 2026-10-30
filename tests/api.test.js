// Pruebas de integración de la API (33 verificaciones).
// Levantan el backend en un puerto propio contra la base de DATABASE_URL y usan
// SOLO datos con prefijo TEST-, que se borran antes y después de correr.
// Uso: npm test
require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const prisma = require('../lib/prisma');

const PUERTO = process.env.TEST_PORT || 3999;
const B = `http://localhost:${PUERTO}/api`;
let servidor;

async function limpiarDatosTest() {
  await prisma.solicitud.deleteMany({ where: { codigo_sbo: { startsWith: 'TEST-' } } });
  await prisma.historial.deleteMany({ where: { codigo_producto: { startsWith: 'TEST-' } } });
  await prisma.producto.deleteMany({ where: { codigo_producto: { startsWith: 'TEST-' } } });
}

before(async () => {
  await limpiarDatosTest();
  servidor = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: { ...process.env, PORT: String(PUERTO) },
    stdio: 'ignore'
  });
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://localhost:${PUERTO}/`); return; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error('El servidor de pruebas no arrancó');
});

after(async () => {
  servidor?.kill();
  await limpiarDatosTest();
  await prisma.$disconnect();
});

async function api(method, ruta, body) {
  const r = await fetch(B + ruta, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch { /* sin JSON */ }
  return { status: r.status, data };
}

const check = (nombre, cond, detalle = '') => assert.ok(cond, `${nombre}${detalle ? ' → ' + detalle : ''}`);
const producto = async (codigo) => (await api('GET', '/productos')).data.find(p => p.codigo_producto === codigo);
const historial = async (codigo) => (await api('GET', '/historial')).data.filter(h => h.codigo_producto === codigo).reverse();
const transicion = (id, accion, extra = {}) => api('POST', `/solicitudes/${id}/transicion`, { accion, usuario: 'Operario01', ...extra });

// Estado compartido entre pruebas (corren en orden)
let r, p, h, sbo1, sbo2;

test('Grupo 1: validaciones de entrada', async () => {
  r = await api('POST', '/productos', { codigo_producto: 'TEST-G-NEG', descripcion: 'x', categoria: 'TEST', cantidad: -5, operario: 'Operario01' });
  check('Ingreso con cantidad -5 rechazado', r.status === 400, `${r.status} ${r.data?.error}`);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-G-0', descripcion: 'x', categoria: 'TEST', cantidad: 0, operario: 'Operario01' });
  check('Ingreso con cantidad 0 rechazado', r.status === 400, r.data?.error);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-G-X', descripcion: 'x', categoria: 'TEST', cantidad: 'diez', operario: 'Operario01' });
  check('Ingreso con cantidad texto → 400', r.status === 400, r.data?.error);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-G-X' });
  check('Ingreso sin campos → 400', r.status === 400, r.data?.error);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-G-X', descripcion: 'x', categoria: 'TEST', cantidad: 1 });
  check('Ingreso sin operario → 400', r.status === 400, r.data?.error);
  r = await api('PUT', '/productos/999999', { codigo_estanteria: 'R1', operario: 'Operario01' });
  check('Reubicar id inexistente → 404', r.status === 404, r.data?.error);
  r = await api('PUT', '/productos/abc', { codigo_estanteria: 'R1', operario: 'Operario01' });
  check('Reubicar id no numérico → 404', r.status === 404, r.data?.error);
  r = await api('DELETE', '/productos/999999', { operario: 'Operario01' });
  check('Eliminar id inexistente → 404', r.status === 404, r.data?.error);
  r = await api('POST', '/historial', {});
  check('Historial sin campos → 400', r.status === 400, r.data?.error);
  const malo = await fetch(B + '/salida', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{malo' });
  check('JSON mal formado → 400', malo.status === 400);
  r = await api('POST', '/salida', { codigo_producto: 'TEST-G-X', cantidad_retirada: 1, operario: 'Operario01' });
  check('Salida sin motivo → 400', r.status === 400, r.data?.error);
  check('Ningún intento inválido dejó producto ni historial', !(await producto('TEST-G-NEG')) && (await historial('TEST-G-X')).length === 0);
});

test('Grupo 1: historial en la misma transacción', async () => {
  r = await api('POST', '/productos', { codigo_producto: ' TEST-G-001 ', descripcion: 'Cobija QA', categoria: 'TEST', cantidad: 10, operario: 'Operario01' });
  check('Ingreso nuevo → 201 (código con espacios se recorta)', r.status === 201 && r.data.producto.codigo_producto === 'TEST-G-001', `${r.status}`);
  p = await producto('TEST-G-001');
  r = await api('PUT', `/productos/${p.id}`, { codigo_estanteria: 'TEST-RACK', operario: 'Operario02' });
  check('Reubicar → 200 y ubicación Almacenamiento', r.status === 200 && r.data.ubicacion_general === 'Almacenamiento' && r.data.codigo_estanteria === 'TEST-RACK');
  h = await historial('TEST-G-001');
  check('Historial: INGRESO NUEVO y REUBICACIÓN con su operario', h.map(x => x.accion + '/' + x.operario).join(',') === 'INGRESO NUEVO/Operario01,REUBICACIÓN/Operario02', h.map(x => x.accion).join(', '));
});

test('Grupo 2: ingreso adicional suma al stock', async () => {
  r = await api('POST', '/productos', { codigo_producto: 'TEST-G-001', descripcion: 'otra', categoria: 'TEST', cantidad: 5, operario: 'Operario02' });
  check('Ingreso de código existente → 200 y suma', r.status === 200 && r.data.adicional && r.data.producto.cantidad === 15, `stock=${r.data?.producto?.cantidad}`);
  check('Conserva la descripción original', r.data.producto.descripcion === 'Cobija QA');
  h = await historial('TEST-G-001');
  check('Historial: INGRESO ADICIONAL con stock total', h.at(-1).accion === 'INGRESO ADICIONAL' && h.at(-1).detalles.includes('Stock total: 15'), h.at(-1).detalles);
});

test('Grupo 2: reserva de stock al aprobar una SBO', async () => {
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-G-SBO1', beneficiario: 'Fundación QA', creado_por: 'Operario01', items: [{ codigo_producto: 'TEST-G-001', cantidad_solicitada: 6 }, { codigo_producto: 'TEST-G-001', cantidad_solicitada: 2 }] });
  sbo1 = r.data.id;
  check('SBO1 creada con 2 líneas del mismo producto (6 + 2)', r.status === 201);
  r = await transicion(sbo1, 'aprobar');
  p = await producto('TEST-G-001');
  check('Aprobar reserva 8 unidades', r.status === 200 && p.cantidad === 15 && p.cantidad_reservada === 8, `cantidad=${p.cantidad} reservada=${p.cantidad_reservada}`);
  r = await api('POST', '/salida', { codigo_producto: 'TEST-G-001', cantidad_retirada: 8, motivo: 'QA', operario: 'Operario02' });
  check('Salida manual de 8 (solo hay 7 libres) → 400', r.status === 400, r.data?.error);
  r = await api('POST', '/salida', { codigo_producto: 'TEST-G-001', cantidad_retirada: 7, motivo: 'QA', operario: 'Operario02' });
  check('Salida manual de 7 libres → 200', r.status === 200, `nuevaCantidad=${r.data?.nuevaCantidad}`);
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-G-SBO2', beneficiario: 'QA', creado_por: 'Operario01', items: [{ codigo_producto: 'TEST-G-001', cantidad_solicitada: 1 }] });
  sbo2 = r.data.id;
  r = await transicion(sbo2, 'aprobar');
  check('Aprobar otra SBO sin stock libre → 400', r.status === 400, r.data?.error);
});

test('Grupo 2: eliminar con SBO en curso', async () => {
  p = await producto('TEST-G-001');
  r = await api('DELETE', `/productos/${p.id}`, { operario: 'Operario01' });
  check('Eliminar producto con SBO en curso → 409', r.status === 409, r.data?.error);
  r = await api('DELETE', `/productos/${p.id}`, {});
  check('Eliminar sin operario → 400', r.status === 400, r.data?.error);
});

test('Grupo 1: cancelar desde ALISTADA libera la reserva', async () => {
  await transicion(sbo1, 'iniciar', { alistador: 'Operario02' });
  r = await transicion(sbo1, 'finalizar');
  check('SBO1 en ALISTADA con acción cancelar disponible', r.data.estado === 'ALISTADA' && r.data.acciones.includes('cancelar'), r.data.acciones.join(','));
  r = await transicion(sbo1, 'cancelar', { nota: 'Producto dañado' });
  p = await producto('TEST-G-001');
  check('Cancelar desde ALISTADA libera la reserva', r.data.estado === 'CANCELADA' && p.cantidad_reservada === 0 && p.cantidad === 8, `cantidad=${p.cantidad} reservada=${p.cantidad_reservada}`);
});

test('Despacho parcial: descuenta lo alistado y libera toda la reserva', async () => {
  r = await transicion(sbo2, 'aprobar');
  check('SBO2 aprobada ahora que hay stock', r.status === 200);
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-G-SBO3', beneficiario: 'QA', creado_por: 'Operario01', items: [{ codigo_producto: 'TEST-G-001', cantidad_solicitada: 5 }] });
  const sbo3 = r.data.id;
  await transicion(sbo3, 'aprobar');
  p = await producto('TEST-G-001');
  check('Reservadas 1 + 5 = 6 de 8', p.cantidad_reservada === 6, `reservada=${p.cantidad_reservada}`);
  await transicion(sbo3, 'iniciar', { alistador: 'Operario02' });
  const itemId = (await api('GET', `/solicitudes/${sbo3}`)).data.items[0].id;
  await transicion(sbo3, 'finalizar', { cantidades: { [itemId]: 3 } });
  r = await transicion(sbo3, 'despachar');
  p = await producto('TEST-G-001');
  check('Despacho de 3 de 5: stock 8-3=5, reserva queda solo la de SBO2 (1)', r.data.estado === 'DESPACHADA' && p.cantidad === 5 && p.cantidad_reservada === 1, `cantidad=${p.cantidad} reservada=${p.cantidad_reservada}`);
});

test('Concurrencia: dos salidas simultáneas con reserva', async () => {
  const [a, b] = await Promise.all([1, 2].map(() => api('POST', '/salida', { codigo_producto: 'TEST-G-001', cantidad_retirada: 3, motivo: 'QA concurrente', operario: 'Operario01' })));
  p = await producto('TEST-G-001');
  check('Solo una de las dos salidas de 3 pasa (libres: 4)', [a.status, b.status].sort().join() === '200,400' && p.cantidad === 2 && p.cantidad_reservada === 1, `${a.status}/${b.status} cantidad=${p.cantidad} reservada=${p.cantidad_reservada}`);
});

test('Agotar y eliminar', async () => {
  await transicion(sbo2, 'iniciar', { alistador: 'Operario02' });
  await transicion(sbo2, 'finalizar');
  await transicion(sbo2, 'despachar');
  await api('POST', '/salida', { codigo_producto: 'TEST-G-001', cantidad_retirada: 1, motivo: 'agotar', operario: 'Operario01' });
  check('Producto se elimina al llegar a 0 sin reservas', !(await producto('TEST-G-001')));
  r = await api('POST', '/productos', { codigo_producto: 'TEST-G-002', descripcion: 'Eliminar QA', categoria: 'TEST', cantidad: 4, operario: 'Operario01' });
  r = await api('DELETE', `/productos/${r.data.producto.id}`, { operario: 'Operario02' });
  h = await historial('TEST-G-002');
  check('Eliminar sin SBO → 200 y ELIMINACIÓN en historial con unidades', r.status === 200 && h.at(-1).accion === 'ELIMINACIÓN' && h.at(-1).detalles.includes('4 unidades'), h.at(-1)?.detalles);
});
