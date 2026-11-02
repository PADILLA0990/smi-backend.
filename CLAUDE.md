# SMI-Backend (SMI-ControlBAB)

API de inventario de **no perecederos** del Banco de Alimentos de Bogotá. Nada de vencimientos, lotes ni cuarto frío.

## Stack fijo
Node + Express 5 (CommonJS) + Prisma 5 + PostgreSQL en Supabase. Despliegue automático en Render desde `main`. No migrar a otra tecnología.

## Comandos
- `npm run dev`: servidor con nodemon (puerto 3000). Requiere `JWT_SECRET` (ver `.env.example`).
- `npm run dev:pruebas`: servidor en el puerto 3001 contra el esquema `smi_pruebas` (`.env.pruebas`).
- `npm test`: pruebas de integración (autenticación, permisos y las 33 originales) y pruebas unitarias. Corre en `smi_pruebas`, levanta su propio servidor en el puerto 3999 y usa solo datos y usuarios `TEST-`, que limpia antes y después.
- `npm run usuarios:iniciales`: crea admin, Operario01 y Operario02 con contraseñas temporales en `credenciales-iniciales.txt` (fuera de git). Nunca mostrar ese archivo en el chat.
- `npm run verificar [-- --api <URL>]`: consistencia historial ↔ stock, solo lectura.

## Estructura
- `index.js`: arranca el servidor. `app.js`: middlewares (helmet, CORS, cookies), rutas y manejo de errores.
- `lib/config.js`: variables de entorno con valores por defecto.
- `auth/`: login, refresh, logout y cambio de contraseña (`routes.js`), `autenticar` y `autorizar` (`middleware.js`), matriz de permisos (`permisos.js`), bcrypt y JWT (`credenciales.js`).
- `usuarios/routes.js`: gestión de usuarios (Administrador).
- `catalogos/routes.js`: catálogos, parámetros y ubicaciones (`/api/ubicaciones`, para el Mapa).
- `lib/catalogos.js`: definición y validación de catálogos, `resolverActivo` (busca por id o nombre) y parámetros con sus valores por defecto.
- `lib/historial.js`: `registrarHistorial(tx, codigo, accion, req.usuario, detalles)`. El autor siempre sale de la sesión.
- `productos/routes.js`: productos, ingreso, salida, reubicar, editar, kardex, inactivar/activar y borrado físico (solo Administrador, sin movimientos).
- `lib/inventario.js`: lista paginada con filtros y orden, y kardex (reutiliza `recalcular` del verificador).
- `historial/routes.js`: historial con filtros y paginación (`?pagina=`); sin `pagina` devuelve todo.
- `documentos/routes.js`: documentos de ingreso y salida de varias líneas en una transacción (`ING-0001`, `SAL-0001`). Cada condición tiene su propio código.
- `lib/movimientos.js`: crear producto, sumar y retirar stock con su historial. Lo comparten `productos/routes.js` y los documentos; el detalle conserva el formato que lee el verificador.
- `solicitudes/`: SBO (`estados.js` es la máquina de estados; `vencer` es solo del sistema y `renovar` no cambia el estado).
- `lib/solicitudes.js`: código `SBO-0001`, campos calculados (atrasada, vencimiento, tiempos, referencia por línea), lista paginada y vencimiento automático (`revisarVencimientos`, con freno de 5 min; `SBO_REVISION_MS=0` en las pruebas).
- `index.js` revisa vencimientos al arrancar y cada hora. `GET /version` (público) dice qué commit corre en Render: úsalo para confirmar un despliegue.
- `.github/workflows/despertar.yml`: despierta Render todos los días a las 6:00 a. m. (plan gratuito).
- `dashboard/routes.js` y `lib/dashboard.js`: `GET /api/dashboard`, el resumen del panel principal (Fase D4). Reutiliza las reglas del inventario y de las SBO para que los números coincidan con las listas.
- `estanterias/routes.js` y `lib/estanterias.js`: Mapa de Bodega (`GET /api/mapa`) y estanterías. Guardar una estantería genera sus huecos `Z1-A-2-04` como ubicaciones del catálogo (`Ubicacion.estanteriaId`). `npm run estanterias:iniciales` carga la distribución inicial (sin `--aplicar` solo muestra).
- `lib/stock.js`: reservar, liberar, descontar y despachar, con `SELECT … FOR UPDATE`. Un producto agotado se conserva con 0 unidades.
- `lib/errores.js`: errores con status y mensajes en español.
- `scripts/verificar-consistencia.js`: lógica pura reutilizable para Conciliación.
- `scripts/migrar-catalogos.js`: pasa los textos libres a los catálogos (solo muestra; aplica con `--aplicar`).
- `docs/`: PROGRESO.md, SUPUESTOS.md y API.md. Es la documentación compartida con el frontend.

## Reglas
- Todo movimiento de stock y su historial van en **la misma transacción** (`prisma.$transaction`).
- El SQL directo (`$queryRaw`) nombra las tablas con su esquema (ver `tablaProducto` en `lib/stock.js`). Con el pooler en modo transacción, el `search_path` no es confiable.
- **Cualquier cambio en la base de producción requiere autorización explícita del usuario.**
  - Migraciones versionadas y aditivas en `prisma/migrations` (nunca `db push`). Se prueban primero con `migrate deploy` en `smi_pruebas`.
  - En producción, la primera vez se marca la línea base con `migrate resolve --applied 0_init`. Antes de aplicar se respalda con `pg_dump`.
- Producción quedó vacía el 31/10/2026: ROP-005 y APP-005 eran de prueba y se borraron con autorización (respaldo `respaldos/respaldo-smi-20261031-antes-borrar-pruebas.dump`). Todo dato que se cargue desde ahora es real.
- Categoría, ubicación, motivo y organización siempre salen del catálogo (`resolverActivo`); nunca aceptar texto libre nuevo.
- Hay testers usando producción: avisar al usuario 🔴 CERRADO antes de migrar o desplegar, y 🟢 ABIERTO cuando esté verificado.
- Toda ruta nueva bajo `/api` necesita `autorizar('<permiso>')`; los permisos están en `auth/permisos.js`.
- Commits en español, solo cuando el usuario los pida; desplegar solo con autorización.
- Fuera de alcance: escáner y perecederos. El Mapa de Bodega es nuestro desde el 02/11/2026 (sin capacidad ni porcentajes).
