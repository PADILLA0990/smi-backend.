// Revisión estática (sin base de datos): toda ruta bajo /api exige sesión y un permiso de auth/permisos.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PERMISOS } = require('../auth/permisos');

const RAIZ = path.join(__dirname, '..');
// Rutas que controlan el permiso dentro del manejador (documentado en el código)
const EXCEPCIONES = new Set(['solicitudes POST /:id/transicion']);

const archivosDeRutas = () => fs.readdirSync(RAIZ)
  .filter(d => d !== 'node_modules' && d !== 'auth' && fs.existsSync(path.join(RAIZ, d, 'routes.js')))
  .map(d => ({ modulo: d, codigo: fs.readFileSync(path.join(RAIZ, d, 'routes.js'), 'utf8') }));

test('app.js: la sesión se exige antes de montar cualquier ruta de /api distinta de /api/auth', () => {
  const lineas = fs.readFileSync(path.join(RAIZ, 'app.js'), 'utf8').split('\n');
  const autenticar = lineas.findIndex(l => /app\.use\('\/api', autenticar\(\)\)/.test(l));
  assert.ok(autenticar > 0, 'No se encontró app.use(\'/api\', autenticar())');
  lineas.forEach((l, i) => {
    const m = l.match(/app\.use\('(\/api[^']*)',\s*(\w+)/);
    if (m && m[2] !== 'autenticar' && m[1] !== '/api/auth' && !/=>/.test(l)) {
      assert.ok(i > autenticar, `${m[2]} se monta antes de autenticar() (línea ${i + 1})`);
    }
  });
});

test('Cada ruta declara autorizar() con un permiso que existe', () => {
  const sinPermiso = [];
  const desconocidos = [];
  for (const { modulo, codigo } of archivosDeRutas()) {
    let protegidoDesde = Infinity;
    const m = codigo.match(/router\.use\(autorizar\('([^']+)'\)\)/);
    if (m) protegidoDesde = m.index;
    for (const p of codigo.matchAll(/autorizar\('([^']+)'\)/g)) if (!PERMISOS[p[1]]) desconocidos.push(`${modulo}: ${p[1]}`);
    for (const r of codigo.matchAll(/router\.(get|post|put|patch|delete)\('([^']*)'([^\n]*)/g)) {
      const clave = `${modulo} ${r[1].toUpperCase()} ${r[2]}`;
      if (r.index > protegidoDesde || /autorizar\(/.test(r[3]) || EXCEPCIONES.has(clave)) continue;
      sinPermiso.push(clave);
    }
  }
  assert.deepStrictEqual(sinPermiso, [], 'Rutas sin autorizar(): ' + sinPermiso.join(', '));
  assert.deepStrictEqual(desconocidos, [], 'Permisos que no están en auth/permisos.js: ' + desconocidos.join(', '));
});

test('La transición de SBO revisa el permiso de cada acción', () => {
  const codigo = fs.readFileSync(path.join(RAIZ, 'solicitudes/routes.js'), 'utf8');
  assert.match(codigo, /PERMISO_TRANSICION\[accion\][^\n]*tienePermiso/);
});
