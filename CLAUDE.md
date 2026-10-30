# SMI-Backend (SMI-ControlBAB)

API de inventario de **no perecederos** del Banco de Alimentos de Bogotá. Nada de vencimientos, lotes ni cuarto frío.

## Stack fijo
Node + Express 5 (CommonJS) + Prisma 5 + PostgreSQL en Supabase. Despliegue automático en Render desde `main`. No migrar a otra tecnología.

## Comandos
- `npm run dev`: servidor con nodemon (puerto 3000).
- `npm test`: 33 pruebas de integración y las pruebas unitarias. Levanta su propio servidor en el puerto 3999 y usa solo datos `TEST-`, que limpia antes y después.
- `npm run verificar [-- --api <URL>]`: consistencia historial ↔ stock, solo lectura.

## Estructura
- `index.js`: app, historial y manejo de JSON inválido.
- `productos/routes.js`: productos, ingreso, salida, reubicar y eliminar.
- `solicitudes/`: SBO (`estados.js` es la máquina de estados).
- `lib/stock.js`: reservar, liberar, descontar y despachar, con `SELECT … FOR UPDATE`.
- `lib/errores.js`: errores con status y mensajes en español.
- `scripts/verificar-consistencia.js`: lógica pura reutilizable para Conciliación.
- `docs/`: PROGRESO.md, SUPUESTOS.md y, más adelante, API.md. Es la documentación compartida con el frontend.

## Reglas
- Todo movimiento de stock y su historial van en **la misma transacción** (`prisma.$transaction`).
- **Cualquier cambio en la base de producción requiere autorización explícita del usuario.**
  - Hoy no hay carpeta `prisma/migrations`: el esquema se aplicó con `db push`.
  - Desde la Fase B: migraciones versionadas y aditivas. Primero se crea la línea base (`0_init` + `migrate resolve --applied`) y se prueba en un PostgreSQL local.
- Productos reales en producción: ROP-005 y APP-005. No tocarlos.
- Commits en español, solo cuando el usuario los pida; desplegar solo con autorización.
- Fuera de alcance: escáner, la página del Mapa de Bodega (solo se exponen endpoints) y perecederos.
