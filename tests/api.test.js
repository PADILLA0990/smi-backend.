// Pruebas de integración de la API.
// Levantan el backend en un puerto propio contra la base indicada en .env.pruebas
// (esquema smi_pruebas, separado de las tablas reales) y usan SOLO datos y usuarios TEST-,
// que se borran antes y después de correr.
// Uso: npm test
require('dotenv').config({ path: process.env.ARCHIVO_ENV || '.env.pruebas' });
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { cifrarPassword } = require('../auth/credenciales');

const PUERTO = process.env.TEST_PORT || 3999;
const B = `http://localhost:${PUERTO}/api`;
const CLAVE = 'Prueba-12345';
let servidor;

// Usuarios de prueba por rol
const USUARIOS = {
  admin: { usuario: 'TEST-admin', rol: 'ADMINISTRADOR' },
  coord: { usuario: 'TEST-coord', rol: 'COORDINADOR' },
  op: { usuario: 'TEST-op', rol: 'OPERARIO' },
  op2: { usuario: 'TEST-op2', rol: 'OPERARIO' },
  consulta: { usuario: 'TEST-consulta', rol: 'CONSULTA' },
  bloqueo: { usuario: 'TEST-bloqueo', rol: 'OPERARIO' },
  inactivo: { usuario: 'TEST-inactivo', rol: 'OPERARIO' }
};
const tokens = {};

async function limpiarDatosTest() {
  // Productos codificados de prueba (001-QCM-B…): su código no lleva TEST-, pero su categoría sí
  const codificados = (await prisma.producto.findMany({ where: { categoria: { startsWith: 'TEST-' }, NOT: { codigo_producto: { startsWith: 'TEST-' } } }, select: { codigo_producto: true } })).map(p => p.codigo_producto);
  if (codificados.length) {
    await prisma.documento.deleteMany({ where: { lineas: { some: { codigo_producto: { in: codificados } } } } });
    await prisma.historial.deleteMany({ where: { codigo_producto: { in: codificados } } });
    await prisma.producto.deleteMany({ where: { codigo_producto: { in: codificados } } });
  }
  // Conteos de prueba (Fase G): las líneas se borran en cascada
  await prisma.conteo.deleteMany({ where: { creado_por: { startsWith: 'TEST-' } } });
  // Novedades de prueba (Fase E)
  await prisma.novedad.deleteMany({ where: { OR: [{ codigo_producto: { startsWith: 'TEST-' } }, { usuario: { startsWith: 'TEST-' } }] } });
  // Documentos de prueba (Fase D2): los registra un usuario TEST- o incluyen productos TEST-
  await prisma.documento.deleteMany({ where: { OR: [{ operario: { startsWith: 'TEST-' } }, { lineas: { some: { codigo_producto: { startsWith: 'TEST-' } } } }] } });
  // Solicitudes de prueba: código TEST- o creadas por un usuario TEST- (las de código automático SBO-0001…).
  // Su historial va por el código de la SBO, así que se borra antes.
  const solicitudesTest = await prisma.solicitud.findMany({ where: { OR: [{ codigo_sbo: { startsWith: 'TEST-' } }, { creado_por: { startsWith: 'TEST-' } }] }, select: { codigo_sbo: true } });
  await prisma.historial.deleteMany({ where: { codigo_producto: { in: solicitudesTest.map(s => s.codigo_sbo) } } });
  await prisma.solicitud.deleteMany({ where: { codigo_sbo: { in: solicitudesTest.map(s => s.codigo_sbo) } } });
  await prisma.historial.deleteMany({ where: { codigo_producto: { startsWith: 'TEST-' } } });
  await prisma.producto.deleteMany({ where: { codigo_producto: { startsWith: 'TEST-' } } });
  await prisma.usuario.deleteMany({ where: { usuario: { startsWith: 'TEST-' } } });
  // Catálogos de prueba (los productos ya se borraron, así que nada los referencia)
  for (const modelo of ['categoria', 'organizacion', 'tercero', 'motivo', 'unidadManejo']) {
    await prisma[modelo].deleteMany({ where: { nombre: { startsWith: 'TEST-' } } });
  }
  await prisma.ubicacion.deleteMany({ where: { codigo: { startsWith: 'TEST-' } } });
  // Estantería de prueba del Mapa de Bodega: zona Z99 (el código de estantería no admite el prefijo TEST-)
  await prisma.historial.deleteMany({ where: { codigo_producto: { startsWith: 'Z99-' } } });
  await prisma.ubicacion.deleteMany({ where: { OR: [{ estanteria: { zona: 'Z99' } }, { codigo: { startsWith: 'Z99-' } }] } });
  await prisma.estanteria.deleteMany({ where: { zona: 'Z99' } });
  await prisma.elementoPlano.deleteMany({ where: { zona: 'Z99' } });
  await prisma.parametro.deleteMany(); // solo existe en el esquema de pruebas: vuelve a los valores por defecto
}

async function api(method, ruta, body, token = tokens.coord, extra = {}, reintento = true) {
  const headers = { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
  const r = await fetch(B + ruta, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch { /* sin JSON */ }
  // El token de acceso dura 15 min y la suite contra Supabase remoto puede tardar más:
  // si un token de la suite venció, se inicia sesión de nuevo con ese usuario y se reintenta una vez
  const clave = Object.keys(tokens).find(k => tokens[k] === token);
  if (r.status === 401 && reintento && clave && /expir/i.test(data?.error || '')) {
    const nuevo = await login(USUARIOS[clave].usuario);
    if (nuevo.status === 200) {
      tokens[clave] = nuevo.data.accessToken;
      return api(method, ruta, body, tokens[clave], extra, false);
    }
  }
  return { status: r.status, data, headers: r.headers };
}

const login = (usuario, password = CLAVE) => api('POST', '/auth/login', { usuario, password }, null);
const cookieDe = (r) => (r.headers.getSetCookie?.() || []).find(c => c.startsWith('smi_sesion='))?.split(';')[0];

before(async () => {
  await limpiarDatosTest();
  const hash = await cifrarPassword(CLAVE);
  for (const u of Object.values(USUARIOS)) {
    await prisma.usuario.create({ data: { ...u, nombre: u.usuario, password_hash: hash, debe_cambiar_password: false, activo: u !== USUARIOS.inactivo } });
  }
  // Catálogos mínimos para las pruebas de inventario y SBO
  await prisma.categoria.create({ data: { nombre: 'TEST-Cat', prefijo: 'TST' } });
  await prisma.organizacion.create({ data: { nombre: 'TEST-Org' } });
  await prisma.motivo.create({ data: { tipo: 'SALIDA', nombre: 'TEST-Motivo' } });
  await prisma.ubicacion.create({ data: { codigo: 'TEST-RACK' } });
  await prisma.tercero.create({ data: { nombre: 'TEST-Donante-D2', tipo: 'DONANTE' } });
  await prisma.unidadManejo.create({ data: { nombre: 'TEST-Caja', factor: 12 } });
  servidor = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    // SBO_REVISION_MS=0: revisa vencimientos en cada consulta, para poder probarlos
    env: { ...process.env, PORT: String(PUERTO), SBO_REVISION_MS: '0' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://localhost:${PUERTO}/`); break; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  for (const clave of ['admin', 'coord', 'op', 'op2', 'consulta']) {
    const r = await login(USUARIOS[clave].usuario);
    assert.strictEqual(r.status, 200, `login de ${clave}: ${r.data?.error}`);
    tokens[clave] = r.data.accessToken;
  }
});

after(async () => {
  servidor?.kill();
  await limpiarDatosTest();
  await prisma.$disconnect();
});

const check = (nombre, cond, detalle = '') => assert.ok(cond, `${nombre}${detalle ? ' → ' + detalle : ''}`);
const producto = async (codigo) => (await api('GET', '/productos')).data.find(p => p.codigo_producto === codigo);
const historial = async (codigo) => (await api('GET', '/historial')).data.filter(h => h.codigo_producto === codigo).reverse();
const transicion = (id, accion, extra = {}, token = tokens.coord) => api('POST', `/solicitudes/${id}/transicion`, { accion, ...extra }, token);

// Estado compartido entre pruebas (corren en orden)
let r, p, h, sbo1, sbo2;

// ======================= Fase B: autenticación y permisos =======================

test('Fase B: sin sesión o con token inválido no hay acceso', async () => {
  r = await api('GET', '/productos', undefined, null);
  check('Sin token → 401', r.status === 401 && r.data.codigo === 'SIN_SESION');
  r = await api('GET', '/productos', undefined, 'token-falso');
  check('Token falso → 401', r.status === 401 && r.data.codigo === 'TOKEN_INVALIDO');
  const vencido = jwt.sign({ sub: '1', rol: 'ADMINISTRADOR' }, process.env.JWT_SECRET, { expiresIn: -10, issuer: 'smi-controlbab' });
  r = await api('GET', '/productos', undefined, vencido);
  check('Token vencido → 401', r.status === 401 && r.data.codigo === 'TOKEN_VENCIDO');
  const otraClave = jwt.sign({ sub: '1', rol: 'ADMINISTRADOR' }, 'otra-clave-secreta-de-mas-de-32-caracteres!!', { issuer: 'smi-controlbab' });
  r = await api('GET', '/productos', undefined, otraClave);
  check('Token firmado con otra clave → 401', r.status === 401);
  r = await api('POST', '/historial', { codigo_producto: 'TEST-X', accion: 'FALSA', operario: 'nadie' });
  check('Ya no se puede escribir historial directamente → 404', r.status === 404);
});

test('Fase B: login, bloqueo por intentos y usuarios inactivos', async () => {
  r = await login('test-OP');
  check('Login no distingue mayúsculas en el usuario', r.status === 200 && r.data.usuario.usuario === 'TEST-op');
  check('Login no devuelve el hash', r.data.usuario.password_hash === undefined && Array.isArray(r.data.usuario.permisos));
  check('Login deja cookie httpOnly SameSite=Strict', /HttpOnly/i.test(r.headers.getSetCookie().join(';')) && /SameSite=Strict/i.test(r.headers.getSetCookie().join(';')));
  r = await login('TEST-op', 'clave-mala-1');
  check('Contraseña incorrecta → 401 genérico', r.status === 401 && r.data.error === 'Usuario o contraseña incorrectos.');
  r = await login('TEST-no-existe', 'clave-mala-1');
  check('Usuario inexistente → mismo mensaje', r.status === 401 && r.data.error === 'Usuario o contraseña incorrectos.');
  r = await login('TEST-inactivo');
  check('Usuario inactivo no entra', r.status === 401);
  for (let i = 0; i < 4; i++) await login('TEST-bloqueo', 'clave-mala-1');
  r = await login('TEST-bloqueo', 'clave-mala-1');
  check('Quinto intento fallido bloquea → 423', r.status === 423 && r.data.codigo === 'USUARIO_BLOQUEADO');
  r = await login('TEST-bloqueo');
  check('Bloqueado: ni con la clave correcta entra', r.status === 423);
});

test('Fase B: renovación y cierre de sesión', async () => {
  r = await login('TEST-op2');
  const cookie1 = cookieDe(r);
  r = await api('POST', '/auth/refresh', undefined, null, { Cookie: cookie1 });
  const cookie2 = cookieDe(r);
  check('Refresh con la cookie da token nuevo y rota la cookie', r.status === 200 && r.data.accessToken && cookie2 && cookie2 !== cookie1);
  r = await api('POST', '/auth/refresh', undefined, null, { Cookie: cookie1 });
  check('La cookie anterior ya no sirve', r.status === 401);
  r = await api('POST', '/auth/refresh', undefined, null);
  check('Refresh sin cookie → 401', r.status === 401);
  r = await api('POST', '/auth/logout', undefined, null, { Cookie: cookie2 });
  r = await api('POST', '/auth/refresh', undefined, null, { Cookie: cookie2 });
  check('Después de cerrar sesión la cookie no sirve', r.status === 401);
});

test('Fase B: gestión de usuarios y cambio de contraseña obligatorio', async () => {
  r = await api('GET', '/usuarios', undefined, tokens.coord);
  check('Coordinador no gestiona usuarios → 403', r.status === 403);
  r = await api('POST', '/usuarios', { nombre: 'Nuevo QA', usuario: 'TEST-nuevo', rol: 'OPERARIO' }, tokens.admin);
  check('Admin crea usuario y recibe contraseña temporal', r.status === 201 && r.data.passwordTemporal?.length >= 10);
  const temporal = r.data.passwordTemporal;
  const idNuevo = r.data.usuario.id;
  r = await api('POST', '/usuarios', { nombre: 'Otro', usuario: 'test-NUEVO', rol: 'OPERARIO' }, tokens.admin);
  check('Usuario duplicado (sin importar mayúsculas) → 409', r.status === 409);
  r = await login('TEST-nuevo', temporal);
  let tokenNuevo = r.data.accessToken;
  check('Primer ingreso marca cambio obligatorio', r.status === 200 && r.data.usuario.debe_cambiar_password === true);
  r = await api('GET', '/productos', undefined, tokenNuevo);
  check('Sin cambiar la contraseña no puede operar → 403', r.status === 403 && r.data.codigo === 'DEBE_CAMBIAR_PASSWORD');
  r = await api('POST', '/auth/cambiar-password', { actual: temporal, nueva: 'corta1' }, tokenNuevo);
  check('Contraseña débil rechazada', r.status === 400);
  r = await api('POST', '/auth/cambiar-password', { actual: 'incorrecta', nueva: 'NuevaClave2026' }, tokenNuevo);
  check('Contraseña actual incorrecta rechazada', r.status === 400);
  r = await api('POST', '/auth/cambiar-password', { actual: temporal, nueva: 'NuevaClave2026' }, tokenNuevo);
  tokenNuevo = r.data.accessToken;
  check('Cambio de contraseña correcto', r.status === 200 && r.data.usuario.debe_cambiar_password === false);
  r = await api('GET', '/productos', undefined, tokenNuevo);
  check('Ya puede operar', r.status === 200);
  r = await api('PATCH', `/usuarios/${idNuevo}`, { activo: false }, tokens.admin);
  r = await api('GET', '/productos', undefined, tokenNuevo);
  check('Usuario desactivado pierde el acceso de inmediato', r.status === 401 && r.data.codigo === 'USUARIO_INACTIVO');
  r = await api('POST', `/usuarios/${idNuevo}/restablecer`, undefined, tokens.admin);
  check('Restablecer genera otra temporal', r.status === 200 && r.data.passwordTemporal && r.data.usuario.debe_cambiar_password);
  const yo = (await api('GET', '/auth/yo', undefined, tokens.admin)).data;
  r = await api('PATCH', `/usuarios/${yo.id}`, { activo: false }, tokens.admin);
  check('El admin no puede desactivarse a sí mismo', r.status === 400);
  r = await api('PATCH', `/usuarios/${yo.id}`, { rol: 'OPERARIO' }, tokens.admin);
  check('Ni quitarse el rol de Administrador', r.status === 400);
  r = await api('GET', '/usuarios/alistadores', undefined, tokens.consulta);
  check('Alistadores: solo operarios y coordinadores activos', r.status === 200 && r.data.some(u => u.usuario === 'TEST-op2') && !r.data.some(u => ['TEST-admin', 'TEST-consulta', 'TEST-inactivo'].includes(u.usuario)));
});

test('Fase B: permisos por rol y autor real en el historial', async () => {
  r = await api('GET', '/productos', undefined, tokens.consulta);
  check('Consulta puede ver', r.status === 200);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-B-1', descripcion: 'x', categoria: 'TEST-Cat', cantidad: 1 }, tokens.consulta);
  check('Consulta no puede ingresar → 403', r.status === 403 && r.data.codigo === 'SIN_PERMISO');
  r = await api('POST', '/productos', { codigo_producto: 'TEST-B-1', descripcion: 'Rol QA', categoria: 'TEST-Cat', cantidad: 4, operario: 'Suplantado' }, tokens.op);
  check('Operario puede ingresar', r.status === 201);
  h = await historial('TEST-B-1');
  check('El historial guarda el usuario autenticado, no el enviado', h[0].operario === 'TEST-op' && h[0].usuarioId !== null, h[0].operario);
  p = await producto('TEST-B-1');
  r = await api('DELETE', `/productos/${p.id}`, {}, tokens.op);
  check('Operario no puede eliminar → 403', r.status === 403);
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-B-SBO', beneficiario: 'TEST-Org', items: [{ codigo_producto: 'TEST-B-1', cantidad_solicitada: 1 }] }, tokens.op);
  check('Operario puede crear SBO y queda como autor', r.status === 201 && r.data.creado_por === 'TEST-op');
  check('Operario no ve la acción aprobar', !r.data.acciones.includes('aprobar') && !r.data.acciones.includes('cancelar'));
  const idSbo = r.data.id;
  r = await transicion(idSbo, 'aprobar', {}, tokens.op);
  check('Operario no puede aprobar → 403', r.status === 403);
  r = await transicion(idSbo, 'aprobar');
  check('Coordinador aprueba', r.status === 200);
  r = await transicion(idSbo, 'iniciar', { alistador: 'TEST-consulta' }, tokens.op);
  check('Alistador que no es operario ni coordinador → 400', r.status === 400);
  r = await transicion(idSbo, 'iniciar', { alistador: 'TEST-op2' }, tokens.op);
  check('Operario inicia el alistamiento', r.status === 200 && r.data.alistador === 'TEST-op2');
  r = await transicion(idSbo, 'cancelar');
  p = await producto('TEST-B-1');
  r = await api('DELETE', `/productos/${p.id}`, {}, tokens.coord);
  check('Fase D: Coordinador ya no borra físicamente → 403', r.status === 403);
  r = await api('DELETE', `/productos/${p.id}`, {}, tokens.admin);
  check('Fase D: ni el Administrador borra un producto que estuvo en una SBO → 409', r.status === 409, r.data?.error);
  r = await api('POST', `/productos/${p.id}/inactivar`, { justificacion: 'Prueba de roles' }, tokens.op);
  check('Fase D: Operario no inactiva → 403', r.status === 403);
  r = await api('POST', `/productos/${p.id}/inactivar`, { justificacion: 'Prueba de roles' }, tokens.coord);
  check('Fase D: Coordinador inactiva con justificación', r.status === 200 && r.data.activo === false, r.data?.error);
});

test('Fase B: CORS y encabezados de seguridad', async () => {
  r = await api('GET', '/productos', undefined, tokens.consulta, { Origin: 'https://sitio-ajeno.example' });
  check('CORS no autoriza otros sitios', !r.headers.get('access-control-allow-origin'));
  r = await api('GET', '/productos', undefined, tokens.consulta, { Origin: 'https://smi-frontend-murex.vercel.app' });
  check('CORS autoriza el frontend propio', r.headers.get('access-control-allow-origin') === 'https://smi-frontend-murex.vercel.app');
  check('Sin X-Powered-By y con nosniff (helmet)', !r.headers.get('x-powered-by') && r.headers.get('x-content-type-options') === 'nosniff');
});

// ======================= Grupos 1 y 2 (33 verificaciones originales, adaptadas a sesión) =======================

test('Grupo 1: validaciones de entrada', async () => {
  r = await api('POST', '/productos', { codigo_producto: 'TEST-G-NEG', descripcion: 'x', categoria: 'TEST-Cat', cantidad: -5 });
  check('Ingreso con cantidad -5 rechazado', r.status === 400, `${r.status} ${r.data?.error}`);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-G-0', descripcion: 'x', categoria: 'TEST-Cat', cantidad: 0 });
  check('Ingreso con cantidad 0 rechazado', r.status === 400, r.data?.error);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-G-X', descripcion: 'x', categoria: 'TEST-Cat', cantidad: 'diez' });
  check('Ingreso con cantidad texto → 400', r.status === 400, r.data?.error);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-G-X' });
  check('Ingreso sin campos → 400', r.status === 400, r.data?.error);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-G-X', descripcion: 'x', categoria: 'TEST-Cat', cantidad: 1 }, null);
  check('Ingreso sin sesión → 401', r.status === 401, r.data?.error);
  r = await api('PUT', '/productos/999999', { codigo_estanteria: 'R1' });
  check('Reubicar id inexistente → 404', r.status === 404, r.data?.error);
  r = await api('PUT', '/productos/abc', { codigo_estanteria: 'R1' });
  check('Reubicar id no numérico → 404', r.status === 404, r.data?.error);
  r = await api('DELETE', '/productos/999999', {}, tokens.admin);
  check('Eliminar id inexistente → 404', r.status === 404, r.data?.error);
  r = await api('PUT', '/productos/1', {});
  check('Reubicar sin estantería → 400', r.status === 400, r.data?.error);
  const malo = await fetch(B + '/salida', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.coord}` }, body: '{malo' });
  check('JSON mal formado → 400', malo.status === 400);
  r = await api('POST', '/salida', { codigo_producto: 'TEST-G-X', cantidad_retirada: 1 });
  check('Salida sin motivo → 400', r.status === 400, r.data?.error);
  check('Ningún intento inválido dejó producto ni historial', !(await producto('TEST-G-NEG')) && (await historial('TEST-G-X')).length === 0);
});

test('Grupo 1: historial en la misma transacción', async () => {
  r = await api('POST', '/productos', { codigo_producto: ' TEST-G-001 ', descripcion: 'Cobija QA', categoria: 'TEST-Cat', cantidad: 10 }, tokens.op);
  check('Ingreso nuevo → 201 (código con espacios se recorta)', r.status === 201 && r.data.producto.codigo_producto === 'TEST-G-001', `${r.status}`);
  p = await producto('TEST-G-001');
  r = await api('PUT', `/productos/${p.id}`, { codigo_estanteria: 'TEST-RACK' }, tokens.op2);
  check('Reubicar → 200 y ubicación Almacenamiento', r.status === 200 && r.data.ubicacion_general === 'Almacenamiento' && r.data.codigo_estanteria === 'TEST-RACK');
  h = await historial('TEST-G-001');
  check('Historial: INGRESO NUEVO y REUBICACIÓN con su usuario', h.map(x => x.accion + '/' + x.operario).join(',') === 'INGRESO NUEVO/TEST-op,REUBICACIÓN/TEST-op2', h.map(x => x.accion + '/' + x.operario).join(', '));
});

test('Grupo 2: ingreso adicional suma al stock', async () => {
  r = await api('POST', '/productos', { codigo_producto: 'TEST-G-001', descripcion: 'otra', categoria: 'TEST-Cat', cantidad: 5 }, tokens.op2);
  check('Ingreso de código existente → 200 y suma', r.status === 200 && r.data.adicional && r.data.producto.cantidad === 15, `stock=${r.data?.producto?.cantidad}`);
  check('Conserva la descripción original', r.data.producto.descripcion === 'Cobija QA');
  h = await historial('TEST-G-001');
  check('Historial: INGRESO ADICIONAL con stock total', h.at(-1).accion === 'INGRESO ADICIONAL' && h.at(-1).detalles.includes('Stock total: 15'), h.at(-1).detalles);
});

test('Grupo 2: reserva de stock al aprobar una SBO', async () => {
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-G-SBO1', beneficiario: 'TEST-Org', items: [{ codigo_producto: 'TEST-G-001', cantidad_solicitada: 6 }, { codigo_producto: 'TEST-G-001', cantidad_solicitada: 2 }] });
  sbo1 = r.data.id;
  check('SBO1 creada con 2 líneas del mismo producto (6 + 2)', r.status === 201);
  r = await transicion(sbo1, 'aprobar');
  p = await producto('TEST-G-001');
  check('Aprobar reserva 8 unidades', r.status === 200 && p.cantidad === 15 && p.cantidad_reservada === 8, `cantidad=${p.cantidad} reservada=${p.cantidad_reservada}`);
  r = await api('POST', '/salida', { codigo_producto: 'TEST-G-001', cantidad_retirada: 8, motivo: 'TEST-Motivo' }, tokens.op2);
  check('Salida manual de 8 (solo hay 7 libres) → 400', r.status === 400, r.data?.error);
  r = await api('POST', '/salida', { codigo_producto: 'TEST-G-001', cantidad_retirada: 7, motivo: 'TEST-Motivo' }, tokens.op2);
  check('Salida manual de 7 libres → 200', r.status === 200, `nuevaCantidad=${r.data?.nuevaCantidad}`);
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-G-SBO2', beneficiario: 'TEST-Org', items: [{ codigo_producto: 'TEST-G-001', cantidad_solicitada: 1 }] });
  sbo2 = r.data.id;
  r = await transicion(sbo2, 'aprobar');
  check('Aprobar otra SBO sin stock libre → 400', r.status === 400, r.data?.error);
});

test('Grupo 2: inactivar con SBO en curso', async () => {
  p = await producto('TEST-G-001');
  r = await api('POST', `/productos/${p.id}/inactivar`, { justificacion: 'No debería pasar' });
  check('Inactivar producto con SBO en curso → 409', r.status === 409, r.data?.error);
  r = await api('POST', `/productos/${p.id}/inactivar`, { justificacion: 'No debería pasar' }, tokens.op);
  check('Inactivar sin permiso → 403', r.status === 403, r.data?.error);
});

test('Grupo 1: cancelar desde ALISTADA libera la reserva', async () => {
  await transicion(sbo1, 'iniciar', { alistador: 'TEST-op2' });
  r = await transicion(sbo1, 'finalizar');
  check('SBO1 en ALISTADA con acción cancelar disponible', r.data.estado === 'ALISTADA' && r.data.acciones.includes('cancelar'), r.data.acciones.join(','));
  r = await transicion(sbo1, 'cancelar', { nota: 'Producto dañado' });
  p = await producto('TEST-G-001');
  check('Cancelar desde ALISTADA libera la reserva', r.data.estado === 'CANCELADA' && p.cantidad_reservada === 0 && p.cantidad === 8, `cantidad=${p.cantidad} reservada=${p.cantidad_reservada}`);
});

test('Despacho parcial: descuenta lo alistado y libera toda la reserva', async () => {
  r = await transicion(sbo2, 'aprobar');
  check('SBO2 aprobada ahora que hay stock', r.status === 200, `${r.status} ${r.data?.error}`);
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-G-SBO3', beneficiario: 'TEST-Org', items: [{ codigo_producto: 'TEST-G-001', cantidad_solicitada: 5 }] });
  const sbo3 = r.data.id;
  await transicion(sbo3, 'aprobar');
  p = await producto('TEST-G-001');
  check('Reservadas 1 + 5 = 6 de 8', p.cantidad_reservada === 6, `reservada=${p.cantidad_reservada}`);
  await transicion(sbo3, 'iniciar', { alistador: 'TEST-op2' });
  const itemId = (await api('GET', `/solicitudes/${sbo3}`)).data.items[0].id;
  r = await transicion(sbo3, 'finalizar', { cantidades: { [itemId]: 3 } });
  check('Fase D3: alistamiento parcial sin nota → 400', r.status === 400 && /nota/i.test(r.data.error), r.data?.error);
  r = await transicion(sbo3, 'finalizar', { cantidades: { [itemId]: 3 }, nota: 'Dos unidades estaban rotas' });
  check('Fase D3: alistamiento parcial con nota', r.status === 200 && r.data.estado === 'ALISTADA' && r.data.eventos.at(-1).nota === 'Dos unidades estaban rotas', r.data?.error);
  r = await transicion(sbo3, 'despachar');
  p = await producto('TEST-G-001');
  check('Despacho de 3 de 5: stock 8-3=5, reserva queda solo la de SBO2 (1)', r.data.estado === 'DESPACHADA' && p.cantidad === 5 && p.cantidad_reservada === 1, `cantidad=${p.cantidad} reservada=${p.cantidad_reservada}`);
});

test('Concurrencia: dos salidas simultáneas con reserva', async () => {
  const [a, b] = await Promise.all([1, 2].map(() => api('POST', '/salida', { codigo_producto: 'TEST-G-001', cantidad_retirada: 3, motivo: 'TEST-Motivo' })));
  p = await producto('TEST-G-001');
  check('Solo una de las dos salidas de 3 pasa (libres: 4)', [a.status, b.status].sort().join() === '200,400' && p.cantidad === 2 && p.cantidad_reservada === 1, `${a.status}/${b.status} cantidad=${p.cantidad} reservada=${p.cantidad_reservada}`);
});

test('Agotar y eliminar', async () => {
  await transicion(sbo2, 'iniciar', { alistador: 'TEST-op2' });
  await transicion(sbo2, 'finalizar');
  await transicion(sbo2, 'despachar');
  await api('POST', '/salida', { codigo_producto: 'TEST-G-001', cantidad_retirada: 1, motivo: 'TEST-Motivo' });
  p = await producto('TEST-G-001');
  check('Fase D: el producto agotado se conserva con 0 unidades', p && p.cantidad === 0 && p.cantidad_reservada === 0, JSON.stringify(p));
  r = await api('DELETE', `/productos/${p.id}`, {}, tokens.admin);
  check('Fase D: no se borra un producto con movimientos → 409', r.status === 409, r.data?.error);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-G-001', descripcion: 'Cobija QA', categoria: 'TEST-Cat', cantidad: 2 });
  check('Fase D: el agotado vuelve a recibir como INGRESO ADICIONAL', r.status === 200 && r.data.adicional === true && r.data.producto.cantidad === 2, r.data?.error);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-G-002', descripcion: 'Eliminar QA', categoria: 'TEST-Cat', cantidad: 4 });
  const idG2 = r.data.producto.id;
  await api('PATCH', `/productos/${idG2}`, { talla: 'XL' });
  r = await api('DELETE', `/productos/${idG2}`, {});
  check('Fase D: el Coordinador no borra físicamente → 403', r.status === 403);
  r = await api('DELETE', `/productos/${idG2}`, {}, tokens.admin);
  h = await historial('TEST-G-002');
  check('Administrador borra un producto sin movimientos → 200 y ELIMINACIÓN con unidades', r.status === 200 && h.at(-1).accion === 'ELIMINACIÓN' && h.at(-1).detalles.includes('4 unidades'), h.at(-1)?.detalles);
});

// ======================= Fase C: catálogos y parámetros =======================

test('Fase C: catálogos (permisos, validación y duplicados)', async () => {
  r = await api('GET', '/catalogos/categorias', undefined, tokens.consulta);
  check('Consulta puede leer catálogos', r.status === 200 && r.data.some(c => c.nombre === 'Textiles' && c.prefijo === 'ROP'));
  r = await api('POST', '/catalogos/categorias', { nombre: 'TEST-Cat2', prefijo: 'TSB' }, tokens.op);
  check('Operario no administra catálogos → 403', r.status === 403);
  r = await api('POST', '/catalogos/categorias', { nombre: 'TEST-Cat2', prefijo: 'tsb' }, tokens.coord);
  check('Coordinador crea categoría y el prefijo queda en mayúsculas', r.status === 201 && r.data.prefijo === 'TSB', r.data?.error);
  const idCat2 = r.data.id;
  r = await api('POST', '/catalogos/categorias', { nombre: 'test-cat2' }, tokens.coord);
  check('Nombre repetido sin importar mayúsculas → 409', r.status === 409, r.data?.error);
  r = await api('POST', '/catalogos/categorias', { nombre: 'TEST-Cat3', prefijo: 'T1' }, tokens.coord);
  check('Prefijo con números → 400', r.status === 400, r.data?.error);
  r = await api('POST', '/catalogos/organizaciones', { nombre: 'TEST-Org2', nit: '900.123.456-7', correo: 'QA@Fundacion.org', telefono: '+57 601 555 1234' }, tokens.coord);
  check('Organización con NIT y correo normalizados', r.status === 201 && r.data.nit === '900123456-7' && r.data.correo === 'qa@fundacion.org', r.data?.error);
  r = await api('POST', '/catalogos/organizaciones', { nombre: 'TEST-Org3', nit: 'abc' }, tokens.coord);
  check('NIT no válido → 400', r.status === 400);
  r = await api('POST', '/catalogos/motivos', { tipo: 'AJUSTE', nombre: 'TEST-Motivo' }, tokens.coord);
  check('El mismo nombre de motivo se permite en otro tipo', r.status === 201, r.data?.error);
  r = await api('PATCH', `/catalogos/motivos/${r.data.id}`, { tipo: 'SALIDA' }, tokens.coord);
  check('El tipo de un motivo no se puede cambiar', r.status === 400);
  r = await api('POST', '/catalogos/unidades', { nombre: 'TEST-Bulto', factor: 0 }, tokens.coord);
  check('Factor de unidad debe ser ≥ 1', r.status === 400);
  r = await api('POST', '/catalogos/terceros', { tipo: 'AMBOS', nombre: 'TEST-Donante' }, tokens.coord);
  r = await api('GET', '/catalogos/terceros?tipo=PROVEEDOR', undefined, tokens.consulta);
  check('Tercero "AMBOS" aparece entre proveedores', r.data.some(t => t.nombre === 'TEST-Donante'));
  r = await api('GET', '/catalogos/inventados', undefined, tokens.coord);
  check('Catálogo inexistente → 404', r.status === 404);
  r = await api('PATCH', `/catalogos/categorias/${idCat2}`, { activo: false }, tokens.coord);
  check('Desactivar categoría', r.status === 200 && r.data.activo === false);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-C-INA', descripcion: 'x', categoria: 'TEST-Cat2', cantidad: 1 }, tokens.op);
  check('No se puede ingresar con una categoría inactiva', r.status === 400, r.data?.error);
  r = await api('GET', '/catalogos/categorias?activos=1', undefined, tokens.op);
  check('?activos=1 oculta las inactivas', !r.data.some(c => c.nombre === 'TEST-Cat2'));
});

test('Fase C: ingreso, edición, reubicación y salida con catálogos', async () => {
  r = await api('POST', '/productos', { codigo_producto: 'TEST-C-1', descripcion: 'Chaqueta QA', categoria: 'Inventada', cantidad: 3 }, tokens.op);
  check('Categoría fuera del catálogo → 400', r.status === 400 && /categoría/i.test(r.data.error), r.data?.error);
  const cat = (await api('GET', '/catalogos/categorias')).data.find(c => c.nombre === 'TEST-Cat');
  r = await api('GET', `/catalogos/categorias/${cat.id}/siguiente-codigo`);
  check('Código sugerido por prefijo', r.status === 200 && r.data.codigo === 'TST-001', r.data?.codigo);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-C-1', descripcion: 'Chaqueta QA', categoriaId: cat.id, cantidad: 3, talla: 'M', condicion: 'BUENO', grupo: 'Mujer', stock_minimo: 2 }, tokens.op);
  check('Ingreso con atributos nuevos', r.status === 201 && r.data.producto.categoriaId === cat.id && r.data.producto.categoria === 'TEST-Cat' && r.data.producto.estado === 'Buen estado' && r.data.producto.talla === 'M', r.data?.error);
  const idC1 = r.data.producto.id;
  r = await api('POST', '/productos', { codigo_producto: 'TEST-C-2', descripcion: 'x', categoria: 'test-cat', cantidad: 1, condicion: 'ROTO' }, tokens.op);
  check('Condición no válida → 400', r.status === 400);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-C-2', descripcion: 'x', categoria: 'test-cat', cantidad: 1, ubicacion_general: 'Bodega fantasma' }, tokens.op);
  check('Ubicación fuera del catálogo → 400', r.status === 400, r.data?.error);
  r = await api('PATCH', `/productos/${idC1}`, { talla: 'L' }, tokens.op);
  check('Operario no edita atributos → 403', r.status === 403);
  r = await api('PATCH', `/productos/${idC1}`, { talla: 'L', stock_minimo: 5, condicion: 'DETERIORO' }, tokens.coord);
  h = await historial('TEST-C-1');
  check('Editar atributos deja EDICIÓN con antes → después', r.status === 200 && h.at(-1).accion === 'EDICIÓN' && h.at(-1).detalles.includes('talla: M → L') && h.at(-1).operario === 'TEST-coord', h.at(-1)?.detalles);
  r = await api('PATCH', `/productos/${idC1}`, { talla: 'L' }, tokens.coord);
  check('Editar sin cambios → 400', r.status === 400);
  r = await api('PUT', `/productos/${idC1}`, { codigo_estanteria: 'NO-EXISTE' }, tokens.op);
  check('Reubicar a ubicación inexistente → 400', r.status === 400);
  r = await api('PUT', `/productos/${idC1}`, { codigo_estanteria: 'test-rack' }, tokens.op);
  check('Reubicar usa el código canónico del catálogo', r.status === 200 && r.data.codigo_estanteria === 'TEST-RACK');
  r = await api('POST', '/salida', { codigo_producto: 'TEST-C-1', cantidad_retirada: 1, motivo: 'Me lo inventé' }, tokens.op);
  check('Motivo fuera del catálogo → 400', r.status === 400);
  const motivoAjuste = (await api('GET', '/catalogos/motivos?tipo=AJUSTE')).data.find(m => m.nombre === 'TEST-Motivo');
  r = await api('POST', '/salida', { codigo_producto: 'TEST-C-1', cantidad_retirada: 1, motivoId: motivoAjuste.id }, tokens.op);
  check('Un motivo de ajuste no sirve para una salida', r.status === 400);
  r = await api('POST', '/salida', { codigo_producto: 'TEST-C-1', cantidad_retirada: 1, motivo: 'TEST-Motivo', detalle: 'Fundación QA' }, tokens.op);
  h = await historial('TEST-C-1');
  check('Salida con motivo y detalle', r.status === 200 && h.at(-1).detalles === 'Retiro de 1 unidades. Motivo: TEST-Motivo. Detalle: Fundación QA', h.at(-1)?.detalles);
  r = await api('PATCH', `/productos/${idC1}`, { activo: false }, tokens.coord);
  check('Fase D: PATCH ya no cambia "activo" → 400', r.status === 400, r.data?.error);
  r = await api('POST', `/productos/${idC1}/inactivar`, { justificacion: 'no' }, tokens.coord);
  check('Fase D: justificación muy corta → 400', r.status === 400);
  r = await api('POST', `/productos/${idC1}/inactivar`, { justificacion: 'Descontinuado por QA' }, tokens.coord);
  h = await historial('TEST-C-1');
  check('Fase D: INACTIVACIÓN con justificación y unidades en el historial', r.status === 200 && h.at(-1).accion === 'INACTIVACIÓN' && h.at(-1).detalles === 'Justificación: Descontinuado por QA (tenía 2 unidades)', h.at(-1)?.detalles);
  r = await api('POST', `/productos/${idC1}/inactivar`, { justificacion: 'Otra vez QA' }, tokens.coord);
  check('Fase D: inactivar dos veces → 400', r.status === 400);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-C-1', descripcion: 'x', categoria: 'TEST-Cat', cantidad: 1 }, tokens.op);
  check('Producto inactivo no recibe ingresos → 409', r.status === 409);
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-D-INACT', beneficiario: 'TEST-Org', items: [{ codigo_producto: 'TEST-C-1', cantidad_solicitada: 1 }] }, tokens.op);
  check('Fase D: producto inactivo no se puede solicitar en una SBO → 409', r.status === 409, r.data?.error);
});

test('Fase C: SBO con organización y ubicaciones para el Mapa', async () => {
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-C-SBO', beneficiario: 'Fundación inventada', items: [] }, tokens.op);
  check('Organización fuera del catálogo → 400', r.status === 400, r.data?.error);
  const org = (await api('GET', '/catalogos/organizaciones')).data.find(o => o.nombre === 'TEST-Org');
  r = await api('POST', `/productos/${(await producto('TEST-C-1')).id}/activar`, { justificacion: 'Vuelve a recibirse' }, tokens.coord);
  check('Fase D: activar con justificación', r.status === 200 && r.data.activo === true, r.data?.error);
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-C-SBO', organizacionId: org.id, items: [{ codigo_producto: 'TEST-C-1', cantidad_solicitada: 1 }] }, tokens.op);
  check('SBO enlazada a la organización', r.status === 201 && r.data.organizacionId === org.id && r.data.beneficiario === 'TEST-Org', r.data?.error);
  r = await api('GET', '/ubicaciones', undefined, tokens.consulta);
  const rack = r.data.find(u => u.codigo === 'TEST-RACK');
  // Desde la Fase D, TEST-G-001 (reubicado aquí, agotado y con 2 unidades nuevas) se conserva en TEST-RACK
  check('GET /ubicaciones resume productos y unidades', r.status === 200 && rack.productos === 2 && rack.unidades === 4, JSON.stringify(rack));
  r = await api('GET', '/ubicaciones/test-rack/contenido', undefined, tokens.consulta);
  check('Contenido de una ubicación', r.status === 200 && r.data.productos.map(x => x.codigo_producto).sort().join() === 'TEST-C-1,TEST-G-001' && r.data.unidades === 4, JSON.stringify(r.data.productos.map(x => x.codigo_producto)));
  r = await api('GET', '/ubicaciones/NO-EXISTE/contenido', undefined, tokens.consulta);
  check('Ubicación inexistente → 404', r.status === 404);
  r = await api('PATCH', `/catalogos/ubicaciones/${rack.id}`, { activo: false }, tokens.coord);
  check('No se desactiva una ubicación con productos → 409', r.status === 409, r.data?.error);
});

test('Fase C: parámetros de operación', async () => {
  r = await api('GET', '/parametros', undefined, tokens.consulta);
  check('Parámetros con valores por defecto', r.status === 200 && r.data.find(p => p.clave === 'lote_mediano_max').valor === 50);
  r = await api('PUT', '/parametros', { stock_minimo_defecto: 8 }, tokens.op);
  check('Operario no cambia parámetros → 403', r.status === 403);
  r = await api('PUT', '/parametros', { lote_pequeno_max: 80 }, tokens.coord);
  check('Lote pequeño ≥ mediano → 400', r.status === 400);
  r = await api('PUT', '/parametros', { inventado: 1 }, tokens.coord);
  check('Parámetro desconocido → 400', r.status === 400);
  r = await api('PUT', '/parametros', { stock_minimo_defecto: 8, dias_atraso_sbo: 2 }, tokens.coord);
  check('Coordinador guarda parámetros', r.status === 200 && r.data.stock_minimo_defecto === 8 && r.data.dias_atraso_sbo === 2);
});

// ======================= Fase D1: inventario e historial =======================

test('Fase D1: inventario paginado con filtros y orden', async () => {
  r = await api('GET', '/productos?pagina=1&porPagina=2&q=TEST-&estado=todos&orden=codigo_producto', undefined, tokens.consulta);
  check('Lista paginada', r.status === 200 && r.data.datos.length === 2 && r.data.total === 3 && r.data.pagina === 1 && r.data.porPagina === 2, JSON.stringify(r.data).slice(0, 300));
  check('Orden por código ascendente', r.data.datos.map(x => x.codigo_producto).join() === 'TEST-B-1,TEST-C-1');
  r = await api('GET', '/productos?pagina=1&q=TEST-');
  check('Por defecto solo activos', r.data.total === 2 && r.data.datos.every(x => x.activo), r.data.datos.map(x => x.codigo_producto).join());
  r = await api('GET', '/productos?pagina=1&q=TEST-&estado=inactivos');
  check('Filtro de inactivos', r.data.total === 1 && r.data.datos[0].codigo_producto === 'TEST-B-1');
  r = await api('GET', '/productos?pagina=1&q=TEST-&bajoMinimo=1');
  const bajos = r.data.datos.map(x => x.codigo_producto).sort().join();
  check('Bajo stock mínimo (propio 5 y por defecto 8)', bajos === 'TEST-C-1,TEST-G-001' && r.data.datos.every(x => x.bajo_minimo && x.libre < x.stock_minimo_efectivo), bajos);
  r = await api('GET', '/productos?pagina=1&q=TEST-&ubicacion=test-rack');
  check('Filtro por ubicación', r.data.datos.map(x => x.codigo_producto).join() === 'TEST-C-1,TEST-G-001', r.data.datos.map(x => x.codigo_producto).join());
  r = await api('GET', '/productos?pagina=1&q=TEST-&sinUbicar=1&estado=todos');
  check('Filtro sin ubicar', r.data.total === 1 && r.data.datos[0].codigo_producto === 'TEST-B-1', r.data.datos.map(x => x.codigo_producto).join());
  r = await api('GET', '/productos?pagina=1&q=TEST-&estado=todos&orden=cantidad&dir=desc');
  const cantidades = r.data.datos.map(x => x.cantidad);
  check('Orden por cantidad descendente', cantidades.every((c, i) => i === 0 || cantidades[i - 1] >= c), cantidades.join());
  check('Resumen de unidades del filtro', r.data.resumen.unidades === cantidades.reduce((s, c) => s + c, 0));
  check('Última actualización presente', r.data.datos.every(x => !Number.isNaN(Date.parse(x.ultima_actualizacion))));
  r = await api('GET', '/productos?pagina=0');
  check('Página no válida → 400', r.status === 400);
  r = await api('GET', '/productos?pagina=1&orden=inventado');
  check('Orden no válido → 400', r.status === 400);
  r = await api('GET', '/productos?pagina=1&porPagina=500');
  check('Página demasiado grande → 400', r.status === 400);
});

test('Fase D1: kardex del producto', async () => {
  const g1 = await producto('TEST-G-001');
  r = await api('GET', `/productos/${g1.id}/kardex`, undefined, tokens.consulta);
  const movs = r.data.movimientos;
  check('Kardex con saldo acumulado que coincide con el stock', r.status === 200 && r.data.coincide && r.data.saldo_historial === 2 && movs.at(-1).saldo === 2 && movs[0].accion === 'INGRESO NUEVO' && movs[0].saldo === 10, JSON.stringify({ coincide: r.data.coincide, saldo: r.data.saldo_historial, movs: movs.map(m => `${m.accion}:${m.saldo}`) }));
  check('El agotamiento queda en el kardex con saldo 0', movs.some(m => m.saldo === 0));
  const c1 = await producto('TEST-C-1');
  r = await api('GET', `/productos/${c1.id}/kardex`);
  check('Kardex lista las SBO en curso (creada: aún sin reserva)', r.data.reservas.length === 1 && r.data.reservas[0].codigo_sbo === 'TEST-C-SBO' && r.data.reservas[0].reserva_stock === false && r.data.reservas[0].cantidad === 1, JSON.stringify(r.data.reservas));
  check('Kardex de TEST-C-1 sin avisos', r.data.coincide && r.data.avisos.length === 0, JSON.stringify(r.data.avisos));
  r = await api('GET', '/productos/999999/kardex');
  check('Kardex de producto inexistente → 404', r.status === 404);
});

test('Fase D1: historial con filtros y paginación', async () => {
  r = await api('GET', '/historial?pagina=1&porPagina=3&codigo=test-g-001', undefined, tokens.consulta);
  const fechas = r.data.datos.map(x => Date.parse(x.fecha));
  check('Historial paginado y filtrado por código', r.status === 200 && r.data.datos.length === 3 && r.data.total > 3 && r.data.datos.every(x => x.codigo_producto === 'TEST-G-001'), JSON.stringify(r.data).slice(0, 300));
  check('Del más reciente al más antiguo', fechas.every((f, i) => i === 0 || fechas[i - 1] >= f));
  r = await api('GET', '/historial?pagina=1&sbo=TEST-G-SBO3');
  const acciones = r.data.datos.map(x => x.accion);
  check('Filtro por SBO: eventos y despacho, con su SBO enlazada', acciones.includes('SBO DESPACHADA') && acciones.includes('SALIDA SBO') && r.data.datos.every(x => x.sbo === 'TEST-G-SBO3'), acciones.join());
  r = await api('GET', `/historial?pagina=1&accion=${encodeURIComponent('INACTIVACIÓN')}&operario=test-coord&q=QA`);
  check('Filtro por acción, operario y texto', r.data.total === 1 && r.data.datos[0].codigo_producto === 'TEST-C-1', JSON.stringify(r.data.datos.map(x => x.detalles)));
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bogota' });
  r = await api('GET', `/historial?pagina=1&desde=${hoy}&hasta=${hoy}&codigo=TEST-`);
  check('Filtro por fecha (día de Bogotá)', r.status === 200 && r.data.total > 0);
  r = await api('GET', '/historial?pagina=1&desde=2026-13-01');
  check('Fecha no válida → 400', r.status === 400);
  r = await api('GET', '/historial/filtros', undefined, tokens.consulta);
  check('Valores para los filtros', r.status === 200 && r.data.acciones.includes('INACTIVACIÓN') && r.data.operarios.includes('TEST-coord'));
});

// ======================= Fase D2: documentos de ingreso y salida =======================

let doc1;

test('Fase D2: documento de ingreso con varias líneas', async () => {
  const cat = (await api('GET', '/catalogos/categorias')).data.find(c => c.nombre === 'TEST-Cat');
  const caja = (await api('GET', '/catalogos/unidades')).data.find(u => u.nombre === 'TEST-Caja');
  const donante = (await api('GET', '/catalogos/terceros')).data.find(t => t.nombre === 'TEST-Donante-D2');
  const antes = (await producto('TEST-C-1')).cantidad;
  const cuerpo = {
    origen: 'DONACION', terceroId: donante.id, soporte: 'Remisión QA-1', observaciones: 'Prueba D2',
    lineas: [
      { codigo_producto: 'TEST-C-1', cantidad: 2, unidadId: caja.id },
      { codigo_producto: 'TEST-E-001', cantidad: 5, nuevo: { descripcion: 'Linterna QA', categoriaId: cat.id, condicion: 'PERFECTO', ubicacion_general: 'TEST-RACK' } }
    ]
  };
  r = await api('POST', '/documentos/ingreso', cuerpo, tokens.consulta);
  check('Consulta no registra documentos → 403', r.status === 403);
  r = await api('POST', '/documentos/ingreso', cuerpo, tokens.op);
  doc1 = r.data;
  check('Documento de ingreso creado con número consecutivo', r.status === 201 && /^ING-\d{4,}$/.test(doc1.numero) && doc1.operario === 'TEST-op' && doc1.tercero_nombre === 'TEST-Donante-D2' && doc1.lineas.length === 2, JSON.stringify(r.data).slice(0, 300));
  check('Unidad de manejo: 2 cajas × 12 = 24 unidades', doc1.lineas[0].cantidad === 24 && doc1.lineas[0].cantidad_manejo === 2 && doc1.lineas[0].unidad === 'TEST-Caja');
  check('Línea de producto nuevo', doc1.lineas[1].producto_nuevo && doc1.lineas[1].condicion === 'PERFECTO' && doc1.lineas[1].descripcion === 'Linterna QA');
  check('El stock sube con las unidades de la línea', (await producto('TEST-C-1')).cantidad === antes + 24);
  p = await producto('TEST-E-001');
  check('Producto nuevo creado por el documento', p.cantidad === 5 && p.condicion === 'PERFECTO' && p.ubicacion_general === 'TEST-RACK');
  h = await historial('TEST-C-1');
  check('Historial enlazado al documento', h.at(-1).accion === 'INGRESO ADICIONAL' && h.at(-1).documentoId === doc1.id && h.at(-1).detalles.includes('(2 TEST-Caja × 12)') && h.at(-1).detalles.endsWith(`Documento ${doc1.numero}`), h.at(-1)?.detalles);
  h = await historial('TEST-E-001');
  check('Ingreso nuevo con documento y ubicación inicial', h[0].accion === 'INGRESO NUEVO' && h[0].detalles === `Ingresó cantidad: 5. Documento ${doc1.numero}. Ubicación inicial: TEST-RACK`, h[0]?.detalles);

  r = await api('POST', '/documentos/ingreso', { origen: 'COMPRA', lineas: [{ codigo_producto: 'TEST-E-001', cantidad: 1, condicion: 'PERFECTO' }] }, tokens.op);
  check('El siguiente documento toma el consecutivo siguiente', r.status === 201 && r.data.consecutivo === doc1.consecutivo + 1 && r.data.origen === 'COMPRA' && r.data.tercero_nombre === null, r.data?.error);

  const c1 = await producto('TEST-C-1');
  const otra = c1.condicion === 'DANADO' ? 'BUENO' : 'DANADO';
  r = await api('POST', '/documentos/ingreso', { origen: 'DONACION', lineas: [{ codigo_producto: 'TEST-E-001', cantidad: 1 }, { codigo_producto: 'TEST-C-1', cantidad: 1, condicion: otra }] }, tokens.op);
  check('Otra condición en un código existente → 409 con la línea', r.status === 409 && r.data.error.startsWith('Línea 2 (TEST-C-1)'), r.data?.error);
  check('Si una línea falla no se guarda nada', (await producto('TEST-E-001')).cantidad === 6 && (await producto('TEST-C-1')).cantidad === c1.cantidad);

  r = await api('POST', '/documentos/ingreso', { lineas: [{ codigo_producto: 'TEST-E-001', cantidad: 1 }] }, tokens.op);
  check('Sin origen → 400', r.status === 400);
  r = await api('POST', '/documentos/ingreso', { origen: 'COMPRA', terceroId: donante.id, lineas: [{ codigo_producto: 'TEST-E-001', cantidad: 1 }] }, tokens.op);
  check('Un donante no sirve como proveedor → 400', r.status === 400, r.data?.error);
  r = await api('POST', '/documentos/ingreso', { origen: 'DONACION', lineas: [{ codigo_producto: 'TEST-E-001', cantidad: 1 }, { codigo_producto: 'test-e-001', cantidad: 2 }] }, tokens.op);
  check('Código repetido en el documento → 400', r.status === 400, r.data?.error);
  r = await api('POST', '/documentos/ingreso', { origen: 'DONACION', lineas: [{ codigo_producto: 'TEST-NO-EXISTE', cantidad: 1 }] }, tokens.op);
  check('Producto inexistente sin datos de producto nuevo → 404', r.status === 404, r.data?.error);
  r = await api('POST', '/documentos/ingreso', { origen: 'DONACION', lineas: [{ codigo_producto: 'TEST-C-1', cantidad: 1, nuevo: { descripcion: 'Duplicado', categoriaId: cat.id } }] }, tokens.op);
  check('Crear un código que ya existe → 409', r.status === 409, r.data?.error);
  r = await api('POST', '/documentos/ingreso', { origen: 'DONACION', lineas: [] }, tokens.op);
  check('Documento sin líneas → 400', r.status === 400);
});

test('Fase D2: documento de salida', async () => {
  const motivo = (await api('GET', '/catalogos/motivos')).data.find(m => m.nombre === 'TEST-Motivo');
  const org = (await api('GET', '/catalogos/organizaciones')).data.find(o => o.nombre === 'TEST-Org');
  const c1 = (await producto('TEST-C-1')).cantidad;
  r = await api('POST', '/documentos/salida', { motivoId: motivo.id, organizacionId: org.id, lineas: [{ codigo_producto: 'TEST-E-001', cantidad: 3 }, { codigo_producto: 'TEST-C-1', cantidad: 1 }] }, tokens.op);
  check('Documento de salida creado', r.status === 201 && /^SAL-\d{4,}$/.test(r.data.numero) && r.data.motivo_nombre === 'TEST-Motivo' && r.data.organizacion_nombre === 'TEST-Org' && r.data.lineas.length === 2, JSON.stringify(r.data).slice(0, 300));
  const sal = r.data;
  check('El stock baja en cada línea', (await producto('TEST-E-001')).cantidad === 3 && (await producto('TEST-C-1')).cantidad === c1 - 1);
  h = await historial('TEST-E-001');
  check('Retiro con motivo, destino y documento', h.at(-1).accion === 'SALIDA/RETIRO' && h.at(-1).documentoId === sal.id && h.at(-1).detalles === `Retiro de 3 unidades. Motivo: TEST-Motivo. Destino: TEST-Org. Documento ${sal.numero}`, h.at(-1)?.detalles);
  r = await api('POST', '/documentos/salida', { motivoId: motivo.id, lineas: [{ codigo_producto: 'TEST-C-1', cantidad: 1 }, { codigo_producto: 'TEST-E-001', cantidad: 999 }] }, tokens.op);
  check('Stock insuficiente en una línea → 400 y no se guarda nada', r.status === 400 && r.data.error.startsWith('Línea 2 (TEST-E-001)') && (await producto('TEST-C-1')).cantidad === c1 - 1, r.data?.error);
  r = await api('POST', '/documentos/salida', { lineas: [{ codigo_producto: 'TEST-C-1', cantidad: 1 }] }, tokens.op);
  check('Salida sin motivo → 400', r.status === 400);
  r = await api('POST', '/documentos/salida', { motivoId: motivo.id, lineas: [{ codigo_producto: 'TEST-NO-EXISTE', cantidad: 1 }] }, tokens.op);
  check('Salida de un producto inexistente → 404', r.status === 404, r.data?.error);
});

test('Fase D2: consulta de documentos', async () => {
  r = await api('GET', '/documentos?pagina=1&q=TEST-E-001', undefined, tokens.consulta);
  check('Lista de documentos filtrada por código', r.status === 200 && r.data.total === 3 && r.data.datos.every(d => d.lineas > 0 && d.unidades > 0), JSON.stringify(r.data).slice(0, 300));
  r = await api('GET', '/documentos?pagina=1&q=TEST-E-001&tipo=SALIDA');
  check('Filtro por tipo', r.data.total === 1 && r.data.datos[0].tipo === 'SALIDA');
  r = await api('GET', '/documentos?pagina=1&tipo=OTRO');
  check('Tipo no válido → 400', r.status === 400);
  r = await api('GET', `/documentos/${doc1.numero.toLowerCase()}`, undefined, tokens.consulta);
  check('Documento por número, con sus líneas', r.status === 200 && r.data.id === doc1.id && r.data.lineas.length === 2);
  r = await api('GET', '/documentos/999999');
  check('Documento inexistente → 404', r.status === 404);
  r = await api('GET', '/historial?pagina=1&codigo=TEST-E-001');
  check('El historial trae el número del documento', r.data.datos.length === 3 && r.data.datos.every(x => x.documento && x.documento.numero), JSON.stringify(r.data.datos.map(x => x.documento)));
  const e1 = await producto('TEST-E-001');
  r = await api('GET', `/productos/${e1.id}/kardex`);
  check('Kardex del producto creado por documento: coincide y sin avisos', r.data.coincide && r.data.avisos.length === 0 && r.data.movimientos.every(m => m.documento), JSON.stringify(r.data.avisos));
});

// ======================= Fase D3: solicitudes SBO =======================

const DIA_MS = 24 * 60 * 60 * 1000;
// Simula que la solicitud no se mueve desde hace N días (corre hacia atrás la creación y sus eventos)
async function envejecer(id, dias) {
  const fecha = new Date(Date.now() - dias * DIA_MS);
  await prisma.solicitud.update({ where: { id }, data: { fecha_solicitud: fecha } });
  await prisma.solicitudEvento.updateMany({ where: { solicitudId: id }, data: { fecha } });
}

test('Fase D3: código automático y referencia por línea', async () => {
  r = await api('POST', '/productos', { codigo_producto: 'TEST-S-001', descripcion: 'Cobija D3', categoria: 'TEST-Cat', cantidad: 50 }, tokens.op);
  check('Producto para las pruebas de SBO', r.status === 201 || r.status === 200, r.data?.error);
  r = await api('GET', '/solicitudes/siguiente-codigo', undefined, tokens.op);
  const sugerido = r.data.codigo;
  check('Código sugerido con formato SBO-0001', r.status === 200 && /^SBO-\d{4,}$/.test(sugerido), sugerido);
  r = await api('GET', '/solicitudes/siguiente-codigo', undefined, tokens.consulta);
  check('Consulta no pide códigos → 403', r.status === 403);
  r = await api('POST', '/solicitudes', { beneficiario: 'TEST-Org', items: [{ codigo_producto: 'TEST-S-001', cantidad_solicitada: 2 }, { codigo_producto: 'TEST-S-001', cantidad_solicitada: 1 }] }, tokens.op);
  const auto = r.data;
  check('Sin código se asigna el sugerido', r.status === 201 && auto.codigo_sbo === sugerido, `${auto?.codigo_sbo} vs ${sugerido}`);
  check('Referencia por línea SBO-xxxx-<código>, -2 si se repite', auto.items[0].referencia === `${sugerido}-TEST-S-001` && auto.items[1].referencia === `${sugerido}-TEST-S-001-2`, auto.items.map(i => i.referencia).join());
  r = await api('GET', '/solicitudes/siguiente-codigo', undefined, tokens.op);
  check('El siguiente código avanza', Number(r.data.codigo.slice(4)) === Number(sugerido.slice(4)) + 1, r.data.codigo);
  r = await api('POST', '/solicitudes', { codigo_sbo: sugerido, beneficiario: 'TEST-Org', items: [{ codigo_producto: 'TEST-S-001', cantidad_solicitada: 1 }] }, tokens.op);
  check('Código repetido escrito a mano → 409', r.status === 409, r.data?.error);
  r = await api('POST', '/solicitudes', { codigo_sbo: sugerido.toLowerCase(), beneficiario: 'TEST-Org', items: [{ codigo_producto: 'TEST-S-001', cantidad_solicitada: 1 }] }, tokens.op);
  check('El mismo código en minúsculas también es repetido → 409', r.status === 409, `${r.status} ${r.data?.error}`);
  r = await api('GET', `/solicitudes/codigo/${sugerido}`, undefined, tokens.consulta);
  check('Detalle por código', r.status === 200 && r.data.id === auto.id && r.data.eventos.length === 1);
  r = await api('GET', '/solicitudes/codigo/NO-EXISTE', undefined, tokens.consulta);
  check('Código inexistente → 404', r.status === 404);
  r = await api('POST', '/solicitudes', { beneficiario: 'TEST-Org', fecha_requerida: 'mañana', items: [{ codigo_producto: 'TEST-S-001', cantidad_solicitada: 1 }] }, tokens.op);
  check('Fecha requerida no válida → 400 (no error interno)', r.status === 400, `${r.status} ${r.data?.error}`);
  r = await api('POST', '/solicitudes', { beneficiario: 'TEST-Org', observaciones: { x: 1 }, items: [{ codigo_producto: 'TEST-S-001', cantidad_solicitada: 1 }] }, tokens.op);
  check('Observaciones que no son texto → 400', r.status === 400, `${r.status} ${r.data?.error}`);
});

test('Fase D3: lista paginada con filtros, atrasada y tiempos', async () => {
  const org = (await api('GET', '/catalogos/organizaciones')).data.find(o => o.nombre === 'TEST-Org');
  const hace10 = new Date(Date.now() - 10 * DIA_MS).toISOString().slice(0, 10);
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-D3-ATR', beneficiario: 'TEST-Org', fecha_requerida: hace10, items: [{ codigo_producto: 'TEST-S-001', cantidad_solicitada: 4 }] }, tokens.op);
  const atrasada = r.data;
  check('SBO con fecha requerida vencida queda atrasada', r.status === 201 && atrasada.atrasada === true && atrasada.activa === true, JSON.stringify({ atrasada: atrasada?.atrasada, error: r.data?.error }));
  r = await api('GET', '/solicitudes?pagina=1&q=TEST-D3-ATR', undefined, tokens.consulta);
  check('Búsqueda por código en la lista paginada', r.status === 200 && r.data.total === 1 && r.data.datos[0].codigo_sbo === 'TEST-D3-ATR' && !('eventos' in r.data.datos[0]), JSON.stringify(r.data).slice(0, 200));
  r = await api('GET', `/solicitudes?pagina=1&atrasada=1&organizacionId=${org.id}`);
  check('Filtro de atrasadas y resumen', r.data.datos.some(s => s.codigo_sbo === 'TEST-D3-ATR') && r.data.datos.every(s => s.atrasada) && r.data.resumen.atrasadas >= 1, JSON.stringify(r.data.resumen));
  r = await api('GET', '/solicitudes?pagina=1&q=TEST-S-001&estado=ACTIVAS');
  check('Filtro por producto y estados activos', r.data.total >= 2 && r.data.datos.every(s => s.activa));
  r = await api('GET', '/solicitudes?pagina=1&estado=INVENTADO');
  check('Estado no válido → 400', r.status === 400);
  await transicion(atrasada.id, 'aprobar');
  await transicion(atrasada.id, 'iniciar', { alistador: 'TEST-op2' });
  r = await api('GET', `/solicitudes?pagina=1&alistador=test-op2&q=TEST-D3-ATR`);
  check('Filtro por alistador', r.data.total === 1);
  await transicion(atrasada.id, 'finalizar');
  r = await transicion(atrasada.id, 'despachar');
  check('Despachada: deja de estar atrasada y trae tiempos', r.data.estado === 'DESPACHADA' && r.data.atrasada === false && r.data.tiempos.total_min !== null && r.data.tiempos.alistamiento_min !== null && r.data.items[0].cantidad_despachada === 4, JSON.stringify(r.data.tiempos));
});

test('Fase D3: aviso, renovación y vencimiento por falta de movimiento', async () => {
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-D3-VEN', beneficiario: 'TEST-Org', items: [{ codigo_producto: 'TEST-S-001', cantidad_solicitada: 5 }] }, tokens.op);
  const ven = r.data.id;
  await transicion(ven, 'aprobar');
  p = await producto('TEST-S-001');
  const reservadaAntes = p.cantidad_reservada;
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-D3-AVI', beneficiario: 'TEST-Org', items: [{ codigo_producto: 'TEST-S-001', cantidad_solicitada: 1 }] }, tokens.op);
  const avi = r.data.id;
  check('Recién creada: no está por vencer y no ofrece renovar', r.data.por_vencer === false && r.data.dias_para_vencer === 30 && !r.data.acciones.includes('renovar'), JSON.stringify({ d: r.data.dias_para_vencer, a: r.data.acciones }));

  await envejecer(avi, 27);
  r = await api('GET', `/solicitudes/${avi}`);
  check('A 3 días de vencer: aviso y botón renovar para el coordinador', r.data.por_vencer === true && r.data.dias_para_vencer === 3 && r.data.acciones.includes('renovar'), JSON.stringify({ d: r.data.dias_para_vencer, a: r.data.acciones }));
  r = await api('GET', `/solicitudes/${avi}`, undefined, tokens.op);
  check('El operario no ve renovar', !r.data.acciones.includes('renovar'));
  r = await transicion(avi, 'renovar', {}, tokens.op);
  check('Operario no renueva → 403', r.status === 403);
  r = await api('GET', '/solicitudes?pagina=1&porVencer=1');
  check('Filtro de por vencer', r.data.datos.some(s => s.id === avi) && r.data.datos.every(s => s.por_vencer));
  r = await api('GET', '/solicitudes?pagina=1&porPagina=100&porVencer=1');
  check('El resumen cuenta solo lo que deja el filtro', r.data.resumen.por_vencer === r.data.total && r.data.resumen.atrasadas === r.data.datos.filter(s => s.atrasada).length, JSON.stringify(r.data.resumen));
  r = await transicion(avi, 'renovar');
  check('Renovar: mismo estado, conteo reiniciado y evento', r.status === 200 && r.data.estado === 'CREADA' && r.data.por_vencer === false && r.data.dias_para_vencer === 30 && r.data.eventos.length === 2, JSON.stringify({ s: r.status, e: r.data?.error, d: r.data?.dias_para_vencer }));

  r = await transicion(ven, 'vencer');
  check('Vencer por la API no está permitido → 400', r.status === 400, r.data?.error);
  await envejecer(ven, 31);
  r = await api('GET', `/solicitudes/${ven}`, undefined, tokens.consulta);
  p = await producto('TEST-S-001');
  check('A los 30 días sin movimiento queda VENCIDA y libera la reserva', r.data.estado === 'VENCIDA' && r.data.fecha_vencimiento && r.data.acciones.length === 0 && p.cantidad_reservada === reservadaAntes - 5, `estado=${r.data.estado} reservada=${p.cantidad_reservada} antes=${reservadaAntes}`);
  check('El evento de vencimiento lo registra el sistema', r.data.eventos.at(-1).usuario === 'sistema' && r.data.eventos.at(-1).estado_nuevo === 'VENCIDA');
  h = await historial('TEST-D3-VEN');
  check('Historial SBO VENCIDA', h.some(x => x.accion === 'SBO VENCIDA' && x.operario === 'sistema'), h.map(x => x.accion).join());
  r = await transicion(ven, 'cancelar');
  check('Una vencida ya no se puede cancelar → 400', r.status === 400);
  r = await api('GET', '/solicitudes?pagina=1&estado=VENCIDA&q=TEST-D3');
  check('Filtro por estado VENCIDA', r.data.total === 1 && r.data.datos[0].codigo_sbo === 'TEST-D3-VEN');
});

test('Fase D3: parámetros de vencimiento y versión pública', async () => {
  r = await api('GET', '/parametros', undefined, tokens.consulta);
  check('Parámetros de vencimiento con sus valores por defecto', r.data.find(x => x.clave === 'dias_vencimiento_sbo').valor === 30 && r.data.find(x => x.clave === 'dias_aviso_vencimiento_sbo').valor === 5);
  r = await api('PUT', '/parametros', { dias_aviso_vencimiento_sbo: 30 }, tokens.coord);
  check('Aviso igual o mayor que el vencimiento → 400', r.status === 400, r.data?.error);
  r = await fetch(`http://localhost:${PUERTO}/version`);
  const version = await r.json();
  check('GET /version es público', r.status === 200 && version.commit && version.arranque, JSON.stringify(version));
});

test('Fase D4: resumen del Dashboard', async () => {
  r = await fetch(`${B}/dashboard`);
  check('Sin sesión → 401', r.status === 401);
  r = await api('GET', '/dashboard', undefined, tokens.consulta);
  check('Consulta ve el resumen', r.status === 200 && r.data.inventario && r.data.solicitudes && Array.isArray(r.data.por_categoria), JSON.stringify(r.data).slice(0, 200));
  const antes = r.data;
  check('Los estados de SBO vienen todos, en cero si no hay', Object.keys(antes.solicitudes.por_estado).length === 7 && antes.solicitudes.por_estado.VENCIDA >= 0);

  r = await api('POST', '/productos', { codigo_producto: 'TEST-DB-1', descripcion: 'Cobija Dashboard', categoria: 'Textiles', cantidad: 5, condicion: 'BUENO', stock_minimo: 50 });
  check('Producto de prueba creado', r.status === 201, r.data?.error);
  const hace5 = new Date(Date.now() - 5 * DIA_MS).toISOString().slice(0, 10);
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-DB-SBO', beneficiario: 'TEST-Org', fecha_requerida: hace5, items: [{ codigo_producto: 'TEST-DB-1', cantidad_solicitada: 2 }] });
  check('SBO atrasada creada', r.status === 201, r.data?.error);
  await transicion(r.data.id, 'aprobar');

  r = await api('GET', '/dashboard');
  const d = r.data;
  const inv = d.inventario, inv0 = antes.inventario;
  check('Inventario: suma producto, unidades, reserva y libres', inv.productos === inv0.productos + 1 && inv.unidades === inv0.unidades + 5 && inv.reservadas === inv0.reservadas + 2 && inv.libres === inv0.libres + 3, JSON.stringify({ inv, inv0 }));
  check('Sin ubicar y bajo mínimo', inv.sin_ubicar === inv0.sin_ubicar + 1 && inv.bajo_minimo === inv0.bajo_minimo + 1);
  const textiles = d.por_categoria.find(c => c.nombre === 'Textiles');
  check('Unidades por categoría', textiles && textiles.unidades >= 5, JSON.stringify(d.por_categoria));
  check('SBO por estado, activas y atrasadas', d.solicitudes.por_estado.APROBADA === antes.solicitudes.por_estado.APROBADA + 1 && d.solicitudes.activas === antes.solicitudes.activas + 1 && d.solicitudes.atrasadas === antes.solicitudes.atrasadas + 1);
  check('La SBO atrasada aparece en las alertas', d.solicitudes.alertas.some(s => s.codigo_sbo === 'TEST-DB-SBO' && s.atrasada), JSON.stringify(d.solicitudes.alertas));
  check('El producto aparece en las alertas de inventario', d.productos_alerta.some(p => p.codigo_producto === 'TEST-DB-1' && p.bajo_minimo && p.sin_ubicar), JSON.stringify(d.productos_alerta));
  check('Último movimiento primero', d.ultimos_movimientos.length > 0 && d.ultimos_movimientos[0].codigo_producto === 'TEST-DB-SBO', d.ultimos_movimientos.map(m => m.codigo_producto + ' ' + m.accion).join(' | '));
  check('Coincide con la lista del inventario', (await api('GET', '/productos?pagina=1&sinUbicar=1')).data.total === inv.sin_ubicar && (await api('GET', '/productos?pagina=1&bajoMinimo=1')).data.total === inv.bajo_minimo);
});

test('Mapa de Bodega: estanterías, huecos generados y contenido del mapa', async () => {
  r = await api('POST', '/estanterias', { zona: 'Z99', rack: 'T', niveles: 2, huecos: 3 }, tokens.op);
  check('Operario no crea estanterías → 403', r.status === 403);
  r = await api('POST', '/estanterias', { zona: 'Zona 1', rack: 'T', niveles: 2, huecos: 3 });
  check('Zona con formato inválido → 400', r.status === 400, r.data?.error);
  r = await api('POST', '/estanterias', { zona: 'z99', rack: 't', niveles: 9, huecos: 3 });
  check('Niveles fuera de rango → 400', r.status === 400, r.data?.error);
  r = await api('POST', '/estanterias', { zona: 'z99', rack: 't', niveles: 2, huecos: 3, calle: 'TEST-Calle' });
  check('Crea la estantería Z99-T en mayúsculas', r.status === 201 && r.data.codigo === 'Z99-T', JSON.stringify(r.data));
  const rack = r.data;
  r = await api('POST', '/estanterias', { zona: 'Z99', rack: 'T', niveles: 1, huecos: 1 });
  check('Estantería repetida → 409', r.status === 409);
  r = await api('GET', '/ubicaciones', undefined, tokens.consulta);
  const huecos = r.data.filter(u => u.codigo.startsWith('Z99-T-')).map(u => u.codigo).sort();
  check('Genera 2 × 3 huecos Z99-T-n-0m', huecos.join() === 'Z99-T-1-01,Z99-T-1-02,Z99-T-1-03,Z99-T-2-01,Z99-T-2-02,Z99-T-2-03', huecos.join());

  r = await api('POST', '/productos', { codigo_producto: 'TEST-M-1', descripcion: 'Silla mapa', categoria: 'Textiles', cantidad: 4, condicion: 'BUENO' });
  const prod = r.data.producto;
  r = await api('PUT', `/productos/${prod.id}`, { codigo_estanteria: 'z99-t-2-03' }, tokens.op);
  check('Reubicar a un hueco generado', r.status === 200 && r.data.codigo_estanteria === 'Z99-T-2-03' && r.data.ubicacion_general === 'Zona 99', JSON.stringify(r.data));

  r = await api('GET', '/mapa', undefined, tokens.consulta);
  const zona = r.data.zonas.find(z => z.zona === 'Z99');
  const est = zona?.estanterias.find(e => e.codigo === 'Z99-T');
  check('El mapa trae la zona y la estantería con sus 6 celdas, nivel de arriba primero', est && est.celdas.length === 6 && est.celdas[0].nivel === 2 && est.calle === 'TEST-Calle' && zona.nombre === 'Zona 99', JSON.stringify(est?.celdas?.map(c => c.codigo)));
  const celda = est.celdas.find(c => c.codigo === 'Z99-T-2-03');
  check('La celda muestra el producto y sus unidades', celda.productos.length === 1 && celda.productos[0].codigo_producto === 'TEST-M-1' && celda.unidades === 4);
  check('Ya no está fuera de estanterías', !r.data.fuera_de_estanterias.some(p => p.codigo_producto === 'TEST-M-1') && r.data.resumen.huecos_ocupados >= 1);

  const ocupadasAntes = (await api('GET', '/dashboard')).data.bodega.ubicaciones_ocupadas;
  r = await api('POST', '/productos', { codigo_producto: 'TEST-M-2', descripcion: 'Mesa ingresada al hueco', categoria: 'Textiles', cantidad: 2, condicion: 'BUENO', ubicacion_general: 'Z99-T-1-02' });
  check('Ingreso directo a un hueco', r.status === 201 && r.data.producto.ubicacion_general === 'Z99-T-1-02', r.data?.error);
  r = await api('GET', '/productos?pagina=1&sinUbicar=1&q=TEST-M-');
  check('Un producto en un hueco no cuenta como sin ubicar', r.data.total === 0, r.data.datos.map(p => p.codigo_producto).join());
  r = await api('GET', '/mapa');
  check('El mapa lo muestra en su hueco', r.data.zonas.find(z => z.zona === 'Z99').estanterias[0].celdas.find(c => c.codigo === 'Z99-T-1-02').productos.some(p => p.codigo_producto === 'TEST-M-2'));
  r = await api('GET', '/dashboard');
  check('El Dashboard tampoco lo cuenta sin ubicar', !r.data.productos_alerta.some(p => p.codigo_producto === 'TEST-M-2' && p.sin_ubicar));
  check('El Dashboard cuenta como ocupado el hueco de un ingreso directo', r.data.bodega.ubicaciones_ocupadas === ocupadasAntes + 1, `${ocupadasAntes} → ${r.data.bodega.ubicaciones_ocupadas}`);

  // Casilla "Lleno": la marca planta y bloquea ingresos y reubicaciones al hueco
  r = await api('PATCH', '/mapa/huecos/Z99-T-1-03/lleno', { lleno: true }, tokens.consulta);
  check('Consulta no marca huecos → 403', r.status === 403);
  r = await api('PATCH', '/mapa/huecos/Z99-T-1-03/lleno', { lleno: 'si' }, tokens.op);
  check('Lleno debe ser verdadero o falso → 400', r.status === 400, r.data?.error);
  r = await api('PATCH', '/mapa/huecos/Recepción/lleno', { lleno: true }, tokens.op);
  check('Un área no se marca como llena → 400', r.status === 400, r.data?.error);
  r = await api('PATCH', '/mapa/huecos/z99-t-1-03/lleno', { lleno: true }, tokens.op);
  check('El operario marca el hueco como lleno', r.status === 200 && r.data.lleno === true, JSON.stringify(r.data));
  r = await api('GET', '/mapa');
  check('El mapa muestra el hueco lleno', r.data.zonas.find(z => z.zona === 'Z99').estanterias[0].celdas.find(c => c.codigo === 'Z99-T-1-03').lleno === true);
  r = await api('POST', '/productos', { codigo_producto: 'TEST-M-3', descripcion: 'No cabe', categoria: 'Textiles', cantidad: 1, condicion: 'BUENO', ubicacion_general: 'Z99-T-1-03' });
  check('Producto nuevo a un hueco lleno → 409', r.status === 409 && r.data.error.includes('Z99-T-1-03'), r.data?.error);
  r = await api('PUT', `/productos/${prod.id}`, { codigo_estanteria: 'Z99-T-1-03' }, tokens.op);
  check('Reubicar a un hueco lleno → 409', r.status === 409 && r.data.error.includes('lleno'), r.data?.error);
  await api('PATCH', '/mapa/huecos/Z99-T-1-02/lleno', { lleno: true }, tokens.op);
  r = await api('POST', '/documentos/ingreso', { origen: 'DONACION', lineas: [{ codigo_producto: 'TEST-M-2', cantidad: 1 }] }, tokens.op);
  check('Ingreso de un producto que está en un hueco lleno → 409', r.status === 409 && r.data.error.includes('Z99-T-1-02'), r.data?.error);
  await api('PATCH', '/mapa/huecos/Z99-T-1-02/lleno', { lleno: false }, tokens.op);
  r = await api('PATCH', '/mapa/huecos/Z99-T-1-03/lleno', { lleno: false }, tokens.op);
  check('Se desmarca el hueco', r.status === 200 && r.data.lleno === false);
  r = await api('POST', '/documentos/ingreso', { origen: 'DONACION', lineas: [{ codigo_producto: 'TEST-M-2', cantidad: 1 }] }, tokens.op);
  check('Con el hueco desmarcado vuelve a recibir', r.status === 201, r.data?.error);
  r = await api('GET', '/conciliacion/consistencia');
  check('La casilla no genera avisos de consistencia', !r.data.problemas.some(p => p.codigo_producto.startsWith('Z99-T-')), JSON.stringify(r.data.problemas).slice(0, 300));

  r = await api('PATCH', `/estanterias/${rack.id}`, { huecos: 2 });
  check('No deja quitar un hueco con producto → 409', r.status === 409 && r.data.error.includes('Z99-T-2-03') && r.data.error.includes('TEST-M-1'), r.data?.error);
  r = await api('PATCH', `/estanterias/${rack.id}`, { activo: false });
  check('No deja desactivar una estantería con producto → 409', r.status === 409);
  r = await api('PATCH', `/estanterias/${rack.id}`, { rack: 'U' });
  check('Zona y rack no se cambian → 400', r.status === 400);
  const hueco = (await api('GET', '/catalogos/ubicaciones')).data.find(u => u.codigo === 'Z99-T-1-01');
  r = await api('PATCH', `/catalogos/ubicaciones/${hueco.id}`, { activo: false });
  check('Un hueco no se desactiva desde el catálogo → 409', r.status === 409, r.data?.error);

  await api('PUT', `/productos/${prod.id}`, { codigo_estanteria: 'Z99-T-1-01' }, tokens.op);
  r = await api('PATCH', `/estanterias/${rack.id}`, { huecos: 2, calle: '' });
  check('Con el hueco vacío sí se reduce', r.status === 200 && r.data.huecos === 2 && r.data.calle === null, r.data?.error);
  r = await api('GET', '/ubicaciones?todas=1');
  const quitado = r.data.find(u => u.codigo === 'Z99-T-2-03');
  check('El hueco quitado queda inactivo (no se borra)', quitado && quitado.activo === false);
  r = await api('GET', '/estanterias', undefined, tokens.consulta);
  const fila = r.data.find(e => e.codigo === 'Z99-T');
  check('Lista de estanterías con huecos y productos', fila.ubicaciones === 4 && fila.productos === 2, JSON.stringify(fila));
  r = await api('PATCH', `/estanterias/${rack.id}`, { huecos: 3 });
  check('Al volver a ampliar, el hueco se reactiva', r.status === 200 && (await api('GET', '/ubicaciones')).data.some(u => u.codigo === 'Z99-T-2-03'));

  r = await api('POST', '/estanterias/distribucion-inicial', {}, tokens.op);
  check('Operario no carga la distribución → 403', r.status === 403);
  r = await api('POST', '/estanterias/distribucion-inicial', {});
  check('Distribución inicial', r.status === 201, r.data?.error);
  r = await api('POST', '/estanterias/distribucion-inicial', {});
  check('Cargarla otra vez no crea nada', r.status === 201 && r.data.estanterias.length === 0 && r.data.areas.length === 0, JSON.stringify(r.data));
  r = await api('GET', '/mapa');
  const z1 = r.data.zonas.find(z => z.zona === 'Z1');
  const j = r.data.zonas.find(z => z.zona === 'Z2')?.estanterias.find(e => e.rack === 'J');
  check('Zona 1 con racks A–I y áreas; todos los racks con 4 niveles', z1 && 'ABCDEFGHI'.split('').every(x => z1.estanterias.some(e => e.rack === x && e.niveles === 4)) && z1.areas.some(a => a.codigo === 'Cajas') && j?.niveles === 4, JSON.stringify(z1?.estanterias.map(e => e.codigo)));
});

test('Codificación 001-RCM-B: árbol, código sugerido y validación al crear', async () => {
  const cat = (await api('POST', '/catalogos/categorias', { nombre: 'TEST-Cod' })).data;
  r = await api('PATCH', `/codificacion/categorias/${cat.id}`, { letra: 'q', nombre_variante: 'Público' }, tokens.op);
  check('Operario no edita la codificación → 403', r.status === 403);
  r = await api('PATCH', `/codificacion/categorias/${cat.id}`, { letra: 'q', nombre_variante: 'Público' });
  check('Letra de categoría en mayúscula', r.status === 200 && r.data.letra === 'Q', r.data?.error);
  r = await api('PATCH', `/codificacion/categorias/${cat.id}`, { letra: 'QQ' });
  check('Letra de dos caracteres → 400', r.status === 400);
  const sub = (await api('POST', `/codificacion/categorias/${cat.id}/subcategorias`, { letra: 'c', nombre: 'Camisas' })).data;
  const varM = (await api('POST', `/codificacion/categorias/${cat.id}/variantes`, { letra: 'M', nombre: 'Mujer' })).data;
  r = await api('POST', `/codificacion/categorias/${cat.id}/subcategorias`, { letra: 'C', nombre: 'Otra' });
  check('Subcategoría con letra repetida → 409', r.status === 409);

  const sugerir = (condicion, excluir = '') => api('GET', `/codificacion/siguiente?categoriaId=${cat.id}&subcategoriaId=${sub.id}&varianteId=${varM.id}&condicion=${condicion}&excluir=${excluir}`, undefined, tokens.op);
  r = await sugerir('BUENO');
  check('Primer código sugerido 001-QCM-B', r.data.codigo === '001-QCM-B', JSON.stringify(r.data));
  const base = { descripcion: 'Camisa QA', categoriaId: cat.id, subcategoriaId: sub.id, varianteId: varM.id, cantidad: 3 };
  r = await api('POST', '/productos', { ...base, codigo_producto: '001-QCM-B', condicion: 'BUENO' });
  check('Crea el producto codificado con subcategoría y variante', r.status === 201 && r.data.producto.subcategoriaId === sub.id && r.data.producto.varianteId === varM.id, r.data?.error);
  const prod = r.data.producto;
  r = await sugerir('BUENO');
  check('El consecutivo avanza: 002-QCM-B', r.data.codigo === '002-QCM-B');
  r = await sugerir('BUENO', '002-QCM-B,003-QCM-B');
  check('Excluye los códigos ya usados en el formulario', r.data.codigo === '004-QCM-B', r.data.codigo);
  r = await sugerir('DANADO');
  check('El sufijo sigue el estado (X = dañado)', r.data.codigo === '002-QCM-X');

  r = await api('POST', '/productos', { ...base, codigo_producto: '009-QCM-D', condicion: 'BUENO' });
  check('Sufijo que no coincide con el estado → 400', r.status === 400 && r.data.error.includes('-QCM-B'), r.data?.error);
  r = await api('POST', '/productos', { ...base, codigo_producto: 'CAM-001', condicion: 'BUENO' });
  check('Código libre en categoría codificada → 400', r.status === 400);
  r = await api('POST', '/productos', { descripcion: 'Sin niveles', categoriaId: cat.id, codigo_producto: '010-QCM-B', condicion: 'BUENO', cantidad: 1 });
  check('Sin subcategoría ni variante → 400', r.status === 400 && r.data.error.includes('subcategoría'), r.data?.error);
  r = await api('POST', '/productos', { ...base, codigo_producto: '001-QCM-D', condicion: 'DETERIORO' });
  check('Otra condición: misma base con otro sufijo', r.status === 201, r.data?.error);

  r = await api('POST', '/documentos/ingreso', { origen: 'DONACION', lineas: [{ codigo_producto: '002-QCM-B', cantidad: 2, nuevo: { descripcion: 'Camisa por documento', categoriaId: cat.id, subcategoriaId: sub.id, varianteId: varM.id, condicion: 'BUENO' } }] });
  check('Producto codificado nuevo desde un documento de ingreso', r.status === 201, r.data?.error);

  r = await api('PATCH', `/productos/${prod.id}`, { condicion: 'PERFECTO' });
  check('Un producto codificado no cambia de estado → 400', r.status === 400 && r.data.error.includes('001-QCM-B'), r.data?.error);
  r = await api('PATCH', `/productos/${prod.id}`, { descripcion: 'Camisa QA editada' });
  check('Sí se edita la descripción', r.status === 200);
  r = await api('PATCH', `/codificacion/categorias/${cat.id}`, { letra: 'Y' });
  check('La letra no cambia si ya hay productos → 409', r.status === 409);
  r = await api('PATCH', `/codificacion/subcategorias/${sub.id}`, { letra: 'D' });
  check('La letra de la subcategoría tampoco → 409', r.status === 409);
  r = await api('PATCH', `/codificacion/variantes/${varM.id}`, { activo: false });
  r = await sugerir('BUENO');
  check('Variante desactivada: no sugiere código → 400', r.status === 400, r.data?.error);

  r = await api('GET', '/codificacion', undefined, tokens.consulta);
  const nodo = r.data.find(c => c.id === cat.id);
  check('Árbol con letras, niveles y productos por subcategoría', nodo.letra === 'Q' && nodo.nombre_variante === 'Público' && nodo.subcategorias[0].productos === 3 && nodo.variantes[0].activo === false, JSON.stringify(nodo).slice(0, 300));

  // Carga del árbol: la categoría con el nombre anterior recibe la letra y el nombre nuevo
  const { crearArbol } = require('../lib/codificacion');
  await api('POST', '/catalogos/categorias', { nombre: 'TEST-Viejo' });
  const arbolTest = [{ letra: 'W', nombre: 'TEST-Arbol', antes: ['TEST-Viejo'], variante: 'Tamaño', variantes: [['S', 'Sencillo']], subcategorias: [['C', 'Cobijas'], ['O', 'Otros']] }];
  let res = await crearArbol(prisma, arbolTest);
  const renombrada = await prisma.categoria.findFirst({ where: { letra: 'W' }, include: { subcategorias: true } });
  check('El árbol renombra la categoría anterior y crea sus niveles', renombrada?.nombre === 'TEST-Arbol' && renombrada.subcategorias.length === 2 && res.variantes === 1, JSON.stringify(res));
  res = await crearArbol(prisma, arbolTest);
  check('Cargarlo otra vez no crea nada', res.categorias.length === 0 && res.subcategorias === 0 && res.variantes === 0);
});

test('Fase E: novedades, sustitución, devolución y trazabilidad', async () => {
  const cat = (await api('POST', '/catalogos/categorias', { nombre: 'TEST-CatE' })).data;
  for (const [codigo, cantidad] of [['TEST-E-1', 10], ['TEST-E-2', 10], ['TEST-E-3', 1]]) {
    r = await api('POST', '/productos', { codigo_producto: codigo, descripcion: `Producto ${codigo}`, categoriaId: cat.id, cantidad }, tokens.op);
    assert.strictEqual(r.status, 201, r.data?.error);
  }
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-E-SBO', beneficiario: 'TEST-Org', items: [{ codigo_producto: 'TEST-E-1', cantidad_solicitada: 4 }, { codigo_producto: 'TEST-E-2', cantidad_solicitada: 3 }] }, tokens.op);
  const id = r.data.id;
  const [it1, it2] = r.data.items;
  r = await api('POST', `/solicitudes/${id}/novedades`, { tipo: 'DANADO', itemId: it1.id, cantidad: 1, descripcion: 'Caja mojada' }, tokens.op);
  check('Novedad en CREADA → 400', r.status === 400, r.data?.error);
  await transicion(id, 'aprobar');

  // Sustitución: E-1 → E-3 sin stock suficiente (4 > 1) no deja nada a medias
  r = await api('POST', `/solicitudes/${id}/sustituir`, { itemId: it1.id, codigo_sustituto: 'TEST-E-3', descripcion: 'Talla agotada' }, tokens.op);
  p = await producto('TEST-E-1');
  check('Sustituto sin stock → 400 y la reserva original sigue', r.status === 400 && p.cantidad_reservada === 4, `${r.status} reservada=${p.cantidad_reservada}`);
  r = await api('POST', `/solicitudes/${id}/sustituir`, { itemId: it2.id, codigo_sustituto: 'TEST-E-1', descripcion: 'Equivalente disponible' }, tokens.consulta);
  check('Consulta no sustituye → 403', r.status === 403);
  r = await api('POST', `/solicitudes/${id}/sustituir`, { itemId: it2.id, codigo_sustituto: 'TEST-E-1', descripcion: 'Equivalente disponible' }, tokens.op);
  const p1 = await producto('TEST-E-1'), p2 = await producto('TEST-E-2');
  const item2 = r.data.items?.find(i => i.id === it2.id);
  check('Sustituir: libera E-2 y reserva E-1', r.status === 201 && p1.cantidad_reservada === 7 && p2.cantidad_reservada === 0, `${r.status} ${r.data?.error} e1=${p1?.cantidad_reservada} e2=${p2?.cantidad_reservada}`);
  check('El ítem queda con el sustituto y recuerda el original', item2.codigo_producto === 'TEST-E-1' && item2.codigo_original === 'TEST-E-2');
  check('La sustitución queda como novedad NOV-', r.data.novedades.length === 1 && r.data.novedades[0].tipo === 'SUSTITUCION' && /^NOV-\d{4}$/.test(r.data.novedades[0].codigo));

  // Alistamiento parcial: faltante automático
  await transicion(id, 'iniciar', { alistador: 'TEST-op' });
  r = await api('POST', `/solicitudes/${id}/novedades`, { tipo: 'TALLA_NO_DISPONIBLE', itemId: it1.id, cantidad: 9, descripcion: 'No hay talla M' }, tokens.op);
  check('Cantidad mayor a la solicitada → 400', r.status === 400);
  r = await api('POST', `/solicitudes/${id}/novedades`, { tipo: 'DANADO', itemId: it1.id, cantidad: 1, descripcion: 'Una unidad rota' }, tokens.op);
  check('Novedad manual (dañado) registrada', r.status === 201 && r.data.novedades.some(n => n.tipo === 'DANADO'), r.data?.error);
  r = await transicion(id, 'finalizar', { cantidades: { [it1.id]: 2 }, nota: 'Solo había 2 en buen estado' });
  const faltante = r.data.novedades?.find(n => n.tipo === 'FALTANTE');
  check('Finalizar parcial crea el faltante con la nota', faltante && faltante.cantidad === 2 && faltante.descripcion.includes('Solo había 2'), JSON.stringify(r.data));
  r = await transicion(id, 'despachar');
  p = await producto('TEST-E-1');
  check('Despacho: E-1 baja 2 + 3 = 5 y libera la reserva', p.cantidad === 5 && p.cantidad_reservada === 0, `cantidad=${p.cantidad} reservada=${p.cantidad_reservada}`);

  // Devolución
  r = await api('POST', `/solicitudes/${id}/devolver`, { itemId: it1.id, cantidad: 3, descripcion: 'Devuelven de más' });
  check('Devolver más de lo despachado en ese ítem (2) → 400', r.status === 400, r.data?.error);
  r = await api('POST', `/solicitudes/${id}/devolver`, { itemId: it2.id, cantidad: 3, descripcion: 'No les sirvió' });
  p = await producto('TEST-E-1');
  check('Devolución suma al stock', r.status === 201 && p.cantidad === 8 && r.data.items.find(i => i.id === it2.id).cantidad_devuelta === 3, `${r.status} ${r.data?.error} cantidad=${p?.cantidad}`);
  r = await api('POST', `/solicitudes/${id}/devolver`, { itemId: it2.id, cantidad: 1, descripcion: 'Otra vez' });
  check('No se devuelve dos veces lo mismo → 400', r.status === 400);

  // Consistencia historial ↔ stock con las acciones nuevas
  const { compararConsistencia } = require('../scripts/verificar-consistencia');
  const codigos = ['TEST-E-1', 'TEST-E-2', 'TEST-E-3'];
  const [productosBD, historialBD, solicitudesBD] = await Promise.all([
    prisma.producto.findMany({ where: { codigo_producto: { in: codigos } } }),
    prisma.historial.findMany({ where: { codigo_producto: { in: codigos } } }),
    prisma.solicitud.findMany({ where: { codigo_sbo: 'TEST-E-SBO' }, include: { items: true } })
  ]);
  const consistencia = compararConsistencia({ productos: productosBD, historial: historialBD, solicitudes: solicitudesBD });
  check('El verificador cuadra con devolución, sustitución y novedades', consistencia.every(c => c.ok), JSON.stringify(consistencia.filter(c => !c.ok)));

  // Lista y trazabilidad
  r = await api('GET', '/novedades?pagina=1&sbo=TEST-E-SBO', undefined, tokens.consulta);
  check('Lista de novedades de la SBO (4) con resumen por tipo', r.status === 200 && r.data.total === 4 && r.data.resumen.DEVOLUCION === 1, JSON.stringify(r.data?.resumen));
  r = await api('GET', '/novedades?tipo=FALTANTE&q=TEST-E-1');
  check('Filtro por tipo y texto (sin página: todo)', Array.isArray(r.data) && r.data.length === 1, JSON.stringify(r.data).slice(0, 200));
  r = await api('GET', '/trazabilidad?codigo=test-e-sbo', undefined, tokens.consulta);
  const acciones = r.data.eventos?.map(e => e.accion) || [];
  check('Trazabilidad de la SBO: estados, novedades, despacho y devolución', r.data.tipo === 'sbo' && acciones.includes('SBO APROBADA') && acciones.includes('SALIDA SBO') && acciones.includes('DEVOLUCIÓN SBO') && acciones.some(a => a.startsWith('NOVEDAD')), acciones.join(' | ') || `${r.status} ${r.data?.error}`);
  r = await api('GET', '/trazabilidad?codigo=TEST-E-2');
  const accionesP = r.data.eventos.map(e => e.accion);
  check('Trazabilidad del producto sustituido: ingreso, reserva y sustitución', r.data.tipo === 'producto' && accionesP[0] === 'INGRESO NUEVO' && accionesP.includes('SBO APROBADA') && accionesP.includes('NOVEDAD · Sustitución') && !accionesP.includes('NOVEDAD'), accionesP.join(' | '));
  r = await api('GET', '/trazabilidad?codigo=NO-EXISTE-XYZ');
  check('Código sin registros → 404', r.status === 404);
});

test('Fase F: endpoints de indicadores', async () => {
  r = await api('GET', '/indicadores', undefined, tokens.consulta);
  check('Catálogo de 13 indicadores', r.status === 200 && r.data.length === 13);
  for (const { id } of r.data) {
    const x = await api('GET', `/indicadores/${id}?anio=2026&mes=11`, undefined, tokens.consulta);
    check(`Indicador ${id} responde con datos y cómo se calcula`, x.status === 200 && Array.isArray(x.data.datos) && x.data.como_se_calcula && x.data.periodo === 'Nov 2026', `${x.status} ${x.data?.error}`);
  }
  r = await api('GET', '/indicadores/lotes?anio=2026&mes=13');
  check('Mes inválido → 400', r.status === 400);
  r = await api('GET', '/indicadores/no-existe?anio=2026');
  check('Indicador desconocido → 404', r.status === 404);
  r = await api('GET', '/indicadores/sin-movimiento?anio=2026&dias=0');
  check('Días inválidos → 400', r.status === 400);
  r = await api('GET', '/indicadores', undefined, null);
  check('Sin sesión → 401', r.status === 401);
});

test('Fase G: conteo físico, diferencias y ajustes aprobados', async () => {
  const cat = (await api('POST', '/catalogos/categorias', { nombre: 'TEST-CatG' })).data;
  const motivo = (await api('POST', '/catalogos/motivos', { tipo: 'AJUSTE', nombre: 'TEST-Conteo físico' })).data;
  const motivoSalida = (await api('POST', '/catalogos/motivos', { tipo: 'SALIDA', nombre: 'TEST-Salida G' })).data;
  for (const [codigo, cantidad] of [['TEST-G2-1', 10], ['TEST-G2-2', 5], ['TEST-G2-3', 8]]) {
    r = await api('POST', '/productos', { codigo_producto: codigo, descripcion: `Producto ${codigo}`, categoriaId: cat.id, cantidad }, tokens.op);
    assert.strictEqual(r.status, 201, r.data?.error);
  }
  r = await api('POST', '/conteos', { alcance: 'CATEGORIA', categoriaId: cat.id }, tokens.consulta);
  check('Consulta no crea conteos → 403', r.status === 403);
  r = await api('POST', '/conteos', { alcance: 'CATEGORIA', categoriaId: cat.id }, tokens.op);
  check('Conteo por categoría con sus 3 productos', r.status === 201 && /^CNT-\d{4}$/.test(r.data.codigo) && r.data.lineas.length === 3 && r.data.filtro === 'TEST-CatG', `${r.status} ${r.data?.error}`);
  const conteo = r.data;
  const linea = (c) => conteo.lineas.find(l => l.codigo_producto === c).id;

  // Movimiento después de crear: el conteo compara contra el stock al registrar lo contado
  await api('POST', '/salida', { codigo_producto: 'TEST-G2-1', cantidad_retirada: 2, motivo: motivoSalida.nombre }, tokens.op);
  r = await api('PUT', `/conteos/${conteo.id}/lineas`, { lineas: [{ id: linea('TEST-G2-1'), cantidad_contada: 7 }, { id: linea('TEST-G2-2'), cantidad_contada: 6 }, { id: linea('TEST-G2-3'), cantidad_contada: 8 }] }, tokens.op);
  const l1 = r.data.lineas.find(l => l.codigo_producto === 'TEST-G2-1');
  const l2 = r.data.lineas.find(l => l.codigo_producto === 'TEST-G2-2');
  check('Diferencias en unidades y %, contra el stock al contar', r.status === 200 && l1.cantidad_sistema === 8 && l1.diferencia === -1 && l1.porcentaje === -12.5 && l2.diferencia === 1 && l2.porcentaje === 20, JSON.stringify([l1, l2]));
  check('Resumen: 3 contados, 2 con diferencia, 1 faltante y 1 sobrante', r.data.resumen.contados === 3 && r.data.resumen.con_diferencia === 2 && r.data.resumen.faltantes === 1 && r.data.resumen.sobrantes === 1, JSON.stringify(r.data.resumen));
  r = await api('PUT', `/conteos/${conteo.id}/lineas`, { lineas: [{ id: linea('TEST-G2-3'), cantidad_contada: -1 }] }, tokens.op);
  check('Cantidad negativa → 400', r.status === 400);

  // Reserva: el ajuste no puede dejar menos que lo reservado
  r = await api('POST', '/solicitudes', { codigo_sbo: 'TEST-G2-SBO', beneficiario: 'TEST-Org', items: [{ codigo_producto: 'TEST-G2-1', cantidad_solicitada: 8 }] });
  const sbo = r.data.id;
  await transicion(sbo, 'aprobar');
  r = await api('POST', `/conteos/${conteo.id}/aprobar`, { motivoId: motivo.id }, tokens.op);
  check('Operario no aprueba → 403', r.status === 403);
  r = await api('POST', `/conteos/${conteo.id}/aprobar`, {});
  check('Sin motivo → 400', r.status === 400, r.data?.error);
  r = await api('POST', `/conteos/${conteo.id}/aprobar`, { motivoId: motivo.id });
  check('Ajuste por debajo de lo reservado → 409 y nada cambia', r.status === 409 && (await producto('TEST-G2-2')).cantidad === 5, r.data?.error);
  await transicion(sbo, 'cancelar', { nota: 'Prueba de conteo' });

  r = await api('POST', `/conteos/${conteo.id}/aprobar`, { motivoId: motivo.id, observaciones: 'Conteo de prueba' });
  const [p1, p2, p3] = [await producto('TEST-G2-1'), await producto('TEST-G2-2'), await producto('TEST-G2-3')];
  check('Aprobar: aplica las diferencias y cierra', r.status === 200 && r.data.estado === 'CERRADO' && p1.cantidad === 7 && p2.cantidad === 6 && p3.cantidad === 8, `${r.status} ${r.data?.error} ${p1?.cantidad}/${p2?.cantidad}/${p3?.cantidad}`);
  h = await historial('TEST-G2-1');
  check('Historial: AJUSTE con la diferencia y el motivo', h.at(-1).accion === 'AJUSTE' && h.at(-1).detalles.includes('Ajuste de -1') && h.at(-1).detalles.includes('TEST-Conteo físico'), h.at(-1)?.detalles);
  check('Sin diferencia no hay ajuste', !(await historial('TEST-G2-3')).some(x => x.accion === 'AJUSTE'));
  r = await api('PUT', `/conteos/${conteo.id}/lineas`, { lineas: [{ id: linea('TEST-G2-3'), cantidad_contada: 1 }] }, tokens.op);
  check('Conteo cerrado no se modifica → 400', r.status === 400);

  // Consistencia
  const { compararConsistencia } = require('../scripts/verificar-consistencia');
  const codigos = ['TEST-G2-1', 'TEST-G2-2', 'TEST-G2-3'];
  const consistencia = compararConsistencia({
    productos: await prisma.producto.findMany({ where: { codigo_producto: { in: codigos } } }),
    historial: await prisma.historial.findMany({ where: { codigo_producto: { in: codigos } } }),
    solicitudes: await prisma.solicitud.findMany({ where: { codigo_sbo: 'TEST-G2-SBO' }, include: { items: true } })
  });
  check('El verificador cuadra con los AJUSTE', consistencia.every(c => c.ok), JSON.stringify(consistencia.filter(c => !c.ok)));
  r = await api('GET', '/conciliacion/consistencia');
  check('Reporte de consistencia por API', r.status === 200 && typeof r.data.revisados === 'number' && Array.isArray(r.data.problemas), r.data?.error);
  r = await api('GET', '/conciliacion/consistencia', undefined, tokens.op);
  check('Operario no ve el reporte → 403', r.status === 403);

  // Anular y listar
  r = await api('POST', '/conteos', { alcance: 'TODO' }, tokens.op);
  const otro = r.data.id;
  r = await api('POST', `/conteos/${otro}/anular`);
  check('Anular un conteo abierto', r.status === 200 && r.data.estado === 'ANULADO');
  r = await api('GET', '/conteos', undefined, tokens.consulta);
  check('Lista de conteos con resumen y sin líneas', r.status === 200 && r.data.some(c => c.id === conteo.id && c.resumen.con_diferencia === 2 && !c.lineas), r.data?.error);
});

test('Concurrencia: sustituciones simultáneas y numeración automática', async () => {
  const cat = (await api('GET', '/catalogos/categorias')).data.find(c => c.nombre === 'TEST-Cat');
  const crear = async (codigo_producto) => {
    r = await api('POST', '/documentos/ingreso', { origen: 'DONACION', lineas: [{ codigo_producto, cantidad: 50, nuevo: { descripcion: 'Concurrencia', categoriaId: cat.id, ubicacion_general: 'TEST-RACK' } }] }, tokens.op);
    check(`Ingreso de ${codigo_producto}`, r.status === 201, r.data?.error);
  };
  const aprobada = async (codigo_sbo, codigo_producto, cantidad_solicitada) => {
    r = await api('POST', '/solicitudes', { codigo_sbo, beneficiario: 'TEST-Org', items: [{ codigo_producto, cantidad_solicitada }] }, tokens.op);
    check(`SBO ${codigo_sbo}`, r.status === 201, r.data?.error);
    const creada = r.data;
    r = await transicion(creada.id, 'aprobar');
    check(`Aprobar ${codigo_sbo}`, r.status === 200, r.data?.error);
    return creada;
  };
  const reservado = async (codigo) => (await prisma.producto.findUnique({ where: { codigo_producto: codigo } })).cantidad_reservada;

  for (const c of ['TEST-CONC-A', 'TEST-CONC-B', 'TEST-CONC-C']) await crear(c);
  await aprobada('TEST-CONC-1', 'TEST-CONC-A', 7);
  const s = await aprobada('TEST-CONC-2', 'TEST-CONC-A', 5);
  const itemId = s.items[0].id;
  const dobles = await Promise.all(['TEST-CONC-B', 'TEST-CONC-C'].map(codigo_sustituto => api('POST', `/solicitudes/${s.id}/sustituir`, { itemId, codigo_sustituto, descripcion: 'Sustitución simultánea' })));
  check('Las sustituciones terminan sin error de servidor', dobles.every(x => x.status < 500), dobles.map(x => x.status).join());
  const item = await prisma.solicitudItem.findUnique({ where: { id: itemId } });
  const otro = item.codigo_producto === 'TEST-CONC-B' ? 'TEST-CONC-C' : 'TEST-CONC-B';
  check('La otra SBO conserva su reserva', await reservado('TEST-CONC-A') === 7);
  check('Solo el producto final de la línea queda reservado', await reservado(item.codigo_producto) === 5 && await reservado(otro) === 0);

  await crear('TEST-CONC-N');
  const rSbo = await Promise.all(Array.from({ length: 6 }, () => api('POST', '/solicitudes', { beneficiario: 'TEST-Org', items: [{ codigo_producto: 'TEST-CONC-N', cantidad_solicitada: 1 }] }, tokens.op)));
  check('6 SBO con número automático a la vez', rSbo.every(x => x.status === 201) && new Set(rSbo.map(x => x.data.codigo_sbo)).size === 6, rSbo.map(x => `${x.status} ${x.data?.error || ''}`).join());
  const conNovedades = await aprobada('TEST-CONC-3', 'TEST-CONC-N', 5);
  const rNov = await Promise.all(Array.from({ length: 5 }, () => api('POST', `/solicitudes/${conNovedades.id}/novedades`, { tipo: 'OTRO', itemId: conNovedades.items[0].id, cantidad: 1, descripcion: 'Novedad simultánea' })));
  check('5 novedades a la vez', rNov.every(x => x.status === 201), rNov.map(x => `${x.status} ${x.data?.error || ''}`).join());
  const rCnt = await Promise.all(Array.from({ length: 3 }, () => api('POST', '/conteos', { alcance: 'CATEGORIA', categoriaId: cat.id, observaciones: 'Conteo simultáneo' }, tokens.op)));
  check('3 conteos a la vez', rCnt.every(x => x.status === 201) && new Set(rCnt.map(x => x.data.codigo)).size === 3, rCnt.map(x => `${x.status} ${x.data?.error || ''}`).join());
  for (const x of rCnt) await api('POST', `/conteos/${x.data.id}/anular`, {});
});

test('Plano de bodega: huecos por nivel, posición de los racks y elementos', async () => {
  r = await api('POST', '/estanterias', { zona: 'Z99', rack: 'P', niveles: 3, huecos: 2, huecos_superiores: 3, plano_x: 5, plano_y: 6.5 });
  check('Crea un rack con un hueco más del nivel 2 hacia arriba', r.status === 201 && r.data.huecos_superiores === 3, r.data?.error);
  const rack = r.data;
  const codigos = async () => (await api('GET', '/ubicaciones')).data.filter(u => u.codigo.startsWith('Z99-P-')).map(u => u.codigo).sort().join();
  check('Huecos: 2 en el nivel 1 y 3 en los niveles 2 y 3', (await codigos()) === 'Z99-P-1-01,Z99-P-1-02,Z99-P-2-01,Z99-P-2-02,Z99-P-2-03,Z99-P-3-01,Z99-P-3-02,Z99-P-3-03', await codigos());
  r = await api('GET', '/mapa');
  let est = r.data.zonas.find(z => z.zona === 'Z99').estanterias.find(e => e.codigo === 'Z99-P');
  check('El mapa trae 8 celdas y la posición en el plano', est.celdas.length === 8 && est.celdas.filter(c => c.nivel === 1).length === 2 && est.plano?.x === 5 && est.plano?.y === 6.5 && est.plano?.vertical === true, JSON.stringify(est.plano));
  r = await api('PATCH', `/estanterias/${rack.id}`, { huecos_superiores: 99 });
  check('Huecos superiores fuera de rango → 400', r.status === 400, r.data?.error);
  r = await api('PATCH', `/estanterias/${rack.id}`, { huecos_superiores: null, plano_vertical: false });
  check('Sin huecos superiores: todos los niveles con 2 (los sobrantes se desactivan)', r.status === 200 && (await codigos()) === 'Z99-P-1-01,Z99-P-1-02,Z99-P-2-01,Z99-P-2-02,Z99-P-3-01,Z99-P-3-02', await codigos());

  // Elementos del plano
  r = await api('POST', '/plano', { zona: 'Z99', tipo: 'AREA', etiqueta: 'TEST-Área', x: 1, y: 1, ancho: 4, alto: 3 }, tokens.op);
  check('Operario no edita el plano → 403', r.status === 403);
  r = await api('POST', '/plano', { zona: 'Z99', tipo: 'BODEGA', etiqueta: 'X', x: 1, y: 1, ancho: 4, alto: 3 });
  check('Tipo inválido → 400', r.status === 400);
  r = await api('POST', '/plano', { zona: 'Z99', tipo: 'AREA', etiqueta: 'TEST-Área', x: 1, y: 1, ancho: 4, alto: 3, ubicacion: 'Z99-P-1-01' });
  check('Un área no se enlaza a un hueco de rack → 400', r.status === 400, r.data?.error);
  r = await api('POST', '/plano', { zona: 'z99', tipo: 'AREA', etiqueta: 'TEST-Área', x: 1, y: 1, ancho: 4, alto: 3, ubicacion: 'cajas' });
  check('Crea un área enlazada a su ubicación', r.status === 201 && r.data.zona === 'Z99' && r.data.ubicacion === 'Cajas', r.data?.error);
  const area = r.data;
  r = await api('POST', '/plano', { zona: 'Z99', tipo: 'AREA', etiqueta: 'TEST-Mesa', x: 1, y: 1, ancho: 4, alto: 3, ubicacion: 'Alistamiento 1' });
  check('Alistamiento no es ubicación: no se enlaza → 400', r.status === 400, r.data?.error);
  r = await api('PATCH', `/plano/${area.id}`, { etiqueta: 'TEST-Área 2', x: 2 });
  check('Edita el elemento', r.status === 200 && r.data.etiqueta === 'TEST-Área 2' && r.data.x === 2);
  r = await api('GET', '/mapa', undefined, tokens.consulta);
  const el = r.data.zonas.find(z => z.zona === 'Z99').plano.find(p => p.id === area.id);
  check('El mapa trae el elemento con las unidades del área', el && el.tipo === 'AREA' && typeof el.unidades === 'number', JSON.stringify(el));
  r = await api('GET', '/plano', undefined, tokens.consulta);
  check('Consulta ve el plano', r.status === 200 && r.data.some(p => p.id === area.id));
  r = await api('DELETE', `/plano/${area.id}`);
  check('Borra el elemento', r.status === 200 && (await api('DELETE', `/plano/${area.id}`)).status === 404);

  // Completar una bodega ya cargada (la distribución de la Zona 1 lleva un hueco más arriba)
  r = await api('POST', '/plano/completar', {}, tokens.op);
  check('Operario no completa el plano → 403', r.status === 403);
  r = await api('POST', '/plano/completar', {});
  check('Completar responde los cambios', r.status === 200 && Array.isArray(r.data.racks), r.data?.error);
  r = await api('GET', '/mapa');
  const z1 = r.data.zonas.find(z => z.zona === 'Z1');
  const a = z1.estanterias.find(e => e.rack === 'A');
  check('Rack A: 4 niveles, 4 huecos abajo y 5 en los niveles 2 a 4, con posición en el plano', a.niveles === 4 && a.huecos === 4 && a.huecos_superiores === 5 && a.celdas.length === 19 && a.plano !== null, JSON.stringify({ h: a.huecos, s: a.huecos_superiores, n: a.celdas.length }));
  check('La Zona 1 tiene plano con entradas, puertas y áreas', ['ENTRADA', 'PUERTA', 'AREA', 'CALLE'].every(t => z1.plano.some(p => p.tipo === t)));
  const mesas = z1.plano.filter(p => p.etiqueta.startsWith('Alistamiento'));
  check('Alistamiento: dibujado en el plano, sin ubicación y fuera de las áreas', mesas.length === 2 && mesas.every(p => !p.ubicacion) && !z1.areas.some(x => x.codigo.startsWith('Alistamiento')), JSON.stringify(mesas));
  r = await api('GET', '/ubicaciones');
  check('Alistamiento no aparece en las ubicaciones activas', !r.data.some(u => u.codigo.startsWith('Alistamiento')));
  r = await api('POST', '/plano/completar', {});
  check('Completar otra vez no cambia nada', r.status === 200 && r.data.racks.length === 0 && r.data.elementos === 0 && r.data.areas_retiradas.length === 0, JSON.stringify(r.data));
});
