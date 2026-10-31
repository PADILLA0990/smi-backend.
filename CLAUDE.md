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
- `index.js`: solo arranca el servidor. `app.js`: middlewares (helmet, CORS, cookies), rutas y manejo de errores.
- `lib/config.js`: variables de entorno con valores por defecto.
- `auth/`: login, refresh, logout y cambio de contraseña (`routes.js`), `autenticar` y `autorizar` (`middleware.js`), matriz de permisos (`permisos.js`), bcrypt y JWT (`credenciales.js`).
- `usuarios/routes.js`: gestión de usuarios (Administrador).
- `catalogos/routes.js`: catálogos, parámetros y ubicaciones (`/api/ubicaciones`, para el Mapa).
- `lib/catalogos.js`: definición y validación de catálogos, `resolverActivo` (busca por id o nombre) y parámetros con sus valores por defecto.
- `lib/historial.js`: `registrarHistorial(tx, codigo, accion, req.usuario, detalles)`. El autor siempre sale de la sesión.
- `productos/routes.js`: productos, ingreso, salida, reubicar, editar, kardex, inactivar/activar y borrado físico (solo Administrador, sin movimientos).
- `lib/inventario.js`: lista paginada con filtros y orden, y kardex (reutiliza `recalcular` del verificador).
- `historial/routes.js`: historial con filtros y paginación (`?pagina=`); sin `pagina` devuelve todo.
- `solicitudes/`: SBO (`estados.js` es la máquina de estados).
- `lib/stock.js`: reservar, liberar, descontar y despachar, con `SELECT … FOR UPDATE`. Un producto agotado se conserva con 0 unidades.
- `lib/errores.js`: errores con status y mensajes en español.
- `scripts/verificar-consistencia.js`: lógica pura reutilizable para Conciliación.
- `scripts/migrar-catalogos.js`: pasa los textos libres a los catálogos (solo muestra; aplica con `--aplicar`).
- `docs/`: PROGRESO.md, SUPUESTOS.md y API.md. Es la documentación compartida con el frontend.

## Reglas
- Todo movimiento de stock y su historial van en **la misma transacción** (`prisma.$transaction`).
- **Cualquier cambio en la base de producción requiere autorización explícita del usuario.**
  - Migraciones versionadas y aditivas en `prisma/migrations` (nunca `db push`). Se prueban primero con `migrate deploy` en `smi_pruebas`.
  - En producción, la primera vez se marca la línea base con `migrate resolve --applied 0_init`. Antes de aplicar se respalda con `pg_dump`.
- Productos reales en producción: ROP-005 y APP-005. No tocarlos.
- Categoría, ubicación, motivo y organización siempre salen del catálogo (`resolverActivo`); nunca aceptar texto libre nuevo.
- Hay testers usando producción: avisar al usuario 🔴 CERRADO antes de migrar o desplegar, y 🟢 ABIERTO cuando esté verificado.
- Toda ruta nueva bajo `/api` necesita `autorizar('<permiso>')`; los permisos están en `auth/permisos.js`.
- Commits en español, solo cuando el usuario los pida; desplegar solo con autorización.
- Fuera de alcance: escáner, la página del Mapa de Bodega (solo se exponen endpoints) y perecederos.
