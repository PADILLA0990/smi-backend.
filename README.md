# SMI-ControlBAB · Backend

API del inventario de **no perecederos** del Banco de Alimentos de Bogotá: productos y codificación, ingresos y salidas por documento, solicitudes SBO (aprobación, alistamiento, despacho), novedades y trazabilidad, Mapa de Bodega, indicadores y conciliación (conteos físicos y ajustes).

- Frontend: repositorio `SMI-Frontend` (React + Vite), desplegado en Vercel.
- Endpoints: [`docs/API.md`](docs/API.md) · Avance: [`docs/PROGRESO.md`](docs/PROGRESO.md) · Decisiones: [`docs/SUPUESTOS.md`](docs/SUPUESTOS.md) · Codificación: [`docs/CODIFICACION.md`](docs/CODIFICACION.md) · Guía de pruebas: [`docs/GUIA-PRUEBAS.md`](docs/GUIA-PRUEBAS.md).

## Stack

Node 20+ · Express 5 (CommonJS) · Prisma 5 · PostgreSQL (Supabase). Despliegue automático en Render desde `main`.

## Instalación local

```bash
npm install
cp .env.example .env          # complete DATABASE_URL, DIRECT_URL y JWT_SECRET
npx prisma migrate deploy     # aplica las migraciones de prisma/migrations
npm run usuarios:iniciales    # crea admin, Operario01 y Operario02 (claves en credenciales-iniciales.txt, fuera de git)
npm run dev                   # http://localhost:3000
```

Datos iniciales opcionales (solo muestran lo que harían; aplican con `--aplicar`):

```bash
npm run estanterias:iniciales -- --aplicar   # racks del Mapa de Bodega
npm run codificacion:inicial -- --aplicar    # árbol de codificación 001-RCM-B
```

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión por el pooler de Supabase (puerto 6543, `pgbouncer=true`). |
| `DIRECT_URL` | Sí | Conexión directa (5432) para migraciones y respaldos. |
| `JWT_SECRET` | Sí | Mínimo 32 caracteres. |
| `ACCESO_MINUTOS`, `SESION_HORAS` | No | Duración del token (15 min) y de la sesión (10 h). |
| `MAX_INTENTOS`, `BLOQUEO_MINUTOS`, `LIMITE_LOGIN_IP` | No | Bloqueo por intentos fallidos. |
| `CORS_ORIGINS` | No | Orígenes permitidos, separados por coma. |
| `TRUST_PROXY` | No | Proxies delante del servidor (Vercel + Render = 2). |
| `NODE_ENV`, `PORT` | No | `production` activa la cookie segura. |
| `SBO_REVISION_MS` | No | Freno de la revisión de vencimientos (0 en pruebas). |

## Pruebas

```bash
npm test     # integración + unitarias contra el esquema smi_pruebas (.env.pruebas)
```

- Corren en un esquema aparte (`smi_pruebas`), levantan su propio servidor en el puerto 3999 y solo usan datos y usuarios `TEST-`, que se limpian antes y después.
- `tests/indicadores.test.js` y `tests/consistencia.test.js` son unitarias (no tocan la base).
- `npm run verificar` revisa la consistencia historial ↔ stock (solo lectura); también está en la app: Conciliación → Consistencia.

Usuarios de prueba: los crea la suite (`TEST-admin`, `TEST-coord`, `TEST-op`, `TEST-consulta`) y los borra al terminar. En producción se usan los usuarios reales; sus contraseñas nunca van en el repositorio.

## Roles

| Rol | Puede |
|---|---|
| Administrador | Todo, incluidos usuarios y borrado de productos sin movimientos |
| Coordinador | Operar, editar e inactivar productos, aprobar/despachar/cancelar SBO, Configuración, aprobar ajustes de conteo |
| Operario | Ingresos, salidas, reubicar, crear y alistar SBO, registrar novedades y conteos |
| Consulta | Solo ver |

La matriz completa está en `auth/permisos.js`; el frontend solo oculta lo que el rol no puede hacer.

## Despliegue

1. **Supabase (base de datos):** cada cambio de esquema es una migración aditiva en `prisma/migrations`. Antes de aplicarla en producción se respalda con `pg_dump` y se prueba con `migrate deploy` en `smi_pruebas`. Nunca `db push`.
2. **Render (este backend):** se despliega solo al hacer push a `main`. Orden obligatorio cuando hay migración: respaldo → `npx prisma migrate deploy` → push → confirmar el commit en `GET /version`.
3. **Vercel (frontend):** push a `main` de `SMI-Frontend`. `vercel.json` reenvía `/api` a Render.
4. `.github/workflows/despertar.yml` despierta Render cada mañana (plan gratuito).
