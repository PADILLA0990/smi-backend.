# Progreso de SMI-ControlBAB

Documento compartido de los dos repositorios (smi-backend y smi-frontend).
Producción: frontend https://smi-frontend-murex.vercel.app · backend https://smi-backend-r3ac.onrender.com · base PostgreSQL en Supabase.

## Hecho y desplegado

| Fecha | Entrega | Commits |
|---|---|---|
| 12/10/2026 | Beta inicial: login, inventario, ingresos/retiros, historial | backend `5ce907d`…`081311e`, frontend `a68f74e`, `0220f8c` |
| 30/10/2026 | Fase 1: Solicitudes SBO (máquina de estados, trazabilidad) y corrección de errores de inventario | backend `7f24c5e`, frontend `d1f7cb7` |
| 30/10/2026 | Hook de escáner (guardado y **desconectado** por decisión del usuario) | frontend `9c10443`, `ab810f6` |
| 30/10/2026 | Grupos 1 y 2 de pruebas: historial transaccional, validaciones, reserva de stock, bloqueo de eliminación, sesión persistente, manejo de errores | backend `cef8a7a`, frontend `cb8fb4c` |
| 30/10/2026 | Verificador de consistencia, pruebas en el repositorio y documentación | backend `2d2cae3` |
| 30/10/2026 | Fase A: interfaz y sistema de diseño | frontend `5f7993a` |
| 30/10/2026 | Fase B: usuarios, roles y seguridad (migración 1_usuarios_roles aplicada tras respaldo con pg_dump) | backend `1a56f42`, frontend `9b4844f` |
| 31/10/2026 | Hotfix: el login espera a que el servidor de Render despierte | frontend `88a1bbf` |
| 31/10/2026 | Fase C: configuración y catálogos (migración 2_catalogos aplicada tras respaldo con pg_dump) | backend `f3ab88d`, frontend `a3a5951` |
| 31/10/2026 | Fase D1: inventario e historial (filtros, paginación, kardex, inactivar) | backend `ed1369e`, frontend `ccb1152` |
| 31/10/2026 | Fase D2: ingresos y retiros como documentos (migración 3_documentos aplicada tras respaldo con pg_dump) | backend `46bc309`, frontend `a231bb8` |
| 31/10/2026 | Limpieza de producción: se borraron los productos de prueba ROP-005 y APP-005 y sus 15 registros de historial (autorizado; respaldo `respaldo-smi-20261031-antes-borrar-pruebas.dump`) | — |

## Verificaciones previas (30/10/2026, solo lectura)

### Consistencia historial ↔ stock (`npm run verificar`)
- ROP-005: el historial da 5 unidades en AA02; la tabla guarda 25 en Recepción.
  - La REUBICACIÓN del 21/10 no se aplicó: el backend de entonces tenía `PUT /api/productos/:id` duplicado y el primero fallaba siempre (id como texto); el frontend escribía el historial sin revisar la respuesta.
  - El retiro de 20 (12/10, 5:02 p. m.) se registró antes de que existiera `/api/salida` (commit de las 5:11 p. m.): muy probablemente el stock no se descontó.
  - Ambas causas ya están corregidas. **Pendiente: conteo físico de ROP-005 y ajuste autorizado** (o en la Fase G).
- ROP-001: 3 eliminaciones seguidas y una reubicación después de eliminado (mismo origen). Sin efecto en el stock actual.

### Seguridad de la API
- 🔴 Ningún endpoint exige autenticación; el operario lo envía el cliente (historial falsificable).
- 🔴 Contraseñas de Operario01/02 en texto plano dentro del JavaScript público.
- 🟠 CORS abierto (`*`).
- 🟡 Sin helmet ni límite de intentos.
- ✔ `.env` nunca se subió; el bundle no contiene secretos de la base.
- → Se corrige en la Fase B.

## Fase A · Interfaz y sistema de diseño (30/10/2026, desplegada)

- Tema único (azul marino, tarjetas blancas, campos claros con borde) con contraste WCAG AA verificado; se quitó la columna de 1126 px de la plantilla de Vite.
- Componentes en `SMI-Frontend/src/components/ui/`: PageHeader, Card, Campo, DataTable, Badge, Modal, ConfirmModal, DialogosProvider (confirmaciones y Toasts), Skeleton, EmptyState, ErrorState, SelectBuscable.
- Sin `alert`/`confirm`/`prompt`: ventanas y avisos propios.
- Formatos es-CO (`src/lib/formato.js`): dd/mm/aaaa, 12 h, America/Bogota, miles con punto.
- Aviso "Conectando con el servidor…" y reintento automático de consultas mientras Render despierta.
- Encabezado con usuario, rol y hora; título de pestaña por página; favicon propio; menú colapsable recordado y superpuesto en celular.
- Backend: las 33 pruebas de integración pasaron a `tests/api.test.js` (`npm test`) + 4 pruebas del verificador; carpetas generadas de skills fuera de git.

## Fase B · Usuarios, roles y seguridad (30/10/2026, desplegada)

**Base de datos**
- Migraciones versionadas en `prisma/migrations`:
  - `0_init` es la línea base, idéntica a producción (verificado con `migrate diff`).
  - `1_usuarios_roles` es aditiva: crea el enum `Rol` y las tablas `Usuario` y `SesionRefresh`, y agrega `Historial.usuarioId` opcional.
- Probadas en el esquema `smi_pruebas` de Supabase y aplicadas en producción el 30/10/2026, después del respaldo `respaldos/respaldo-smi-20261030.dump`. Los datos quedaron idénticos antes y después.

**Autenticación** (detalle en `docs/API.md`)
- Contraseñas con bcrypt (costo 12).
- Token de acceso JWT de 15 min y cookie de sesión httpOnly rotativa, guardada como hash.
- Bloqueo tras 5 intentos fallidos, límite de intentos por IP, cambio de contraseña obligatorio en el primer ingreso y detección de reutilización de la sesión.

**Roles y API**
- Cuatro roles (Administrador, Coordinador, Operario, Consulta) con una matriz de permisos en `auth/permisos.js`. Todas las rutas `/api` exigen sesión y permiso.
- El autor del historial sale de la sesión: el cliente ya no envía `operario`.
- Se eliminó `POST /api/historial`.
- Seguridad general: helmet, CORS limitado a los dominios del frontend, límite de 100 kB en el JSON y `trust proxy`.

**Frontend**
- Login contra la API: ya no hay contraseñas en el bundle.
- Pantalla de cambio obligatorio de contraseña y menú de usuario (cambiar contraseña, cerrar sesión).
- Página **Usuarios** para el Administrador: crear con contraseña temporal, cambiar rol, activar o desactivar y restablecer.
- El menú y los botones se ocultan según los permisos, y las rutas sin permiso muestran "Sin acceso".
- La sesión se renueva sola. Al recargar se conserva; al cerrar la pestaña termina.
- `vercel.json` reenvía `/api` a Render (cookie de primera parte) y corrige el 404 al recargar rutas como /inventario.

**Pruebas**
- Backend: 19 de 19 en `smi_pruebas`, que incluyen las 33 verificaciones originales y las nuevas de autenticación, permisos, CORS y helmet.
- Frontend: 17 de 17.
- Navegador: 26 de 26, con roles, cambio obligatorio, gestión de usuarios, renovación automática del token e historial con el usuario real.

**Producción:** usuarios iniciales admin, Operario01 y Operario02 creados con contraseña temporal. `JWT_SECRET` está configurado en Render.

## Fase C · Configuración y catálogos (31/10/2026, desplegada)

**Base de datos**
- Migración `2_catalogos`, aditiva:
  - Tablas `Categoria`, `Organizacion`, `Tercero`, `Motivo`, `UnidadManejo`, `Ubicacion` y `Parametro`.
  - Campos opcionales en `Producto`: `categoriaId`, `talla`, `condicion`, `grupo`, `stock_minimo` y `activo`. En `Solicitud`: `organizacionId`.
  - Valores iniciales: 7 categorías con prefijo, 14 motivos, 5 unidades y la ubicación Recepción.
- Aplicada en `smi_pruebas` y en producción el 31/10/2026, tras el respaldo `respaldos/respaldo-smi-20261031.dump`.
- Escala de condición definida por el usuario: Perfecto estado, Buen estado, En deterioro y Dañado. ROP-005 y APP-005 ("Bueno") quedaron en Buen estado; solo se enlazó categoría y condición, con historial EDICIÓN de "sistema".
- `scripts/migrar-catalogos.js` muestra el mapeo de los textos actuales y lo aplica solo con `--aplicar`.

**API** (detalle en `docs/API.md`)
- Catálogos con validación, sin duplicados y solo desactivación, nunca borrado.
- Parámetros de operación.
- `GET /api/ubicaciones` y `/api/ubicaciones/:codigo/contenido` para el Mapa.
- Edición de productos con historial EDICIÓN (antes → después).
- Ingreso, salida, reubicación y SBO validan contra los catálogos.

**Frontend**
- Configuración con 7 pestañas, con enlace directo `?pestana=`.
- Ingreso con categoría, código sugerido por prefijo, condición, talla, género o grupo, stock mínimo y ubicación inicial.
- Salida con motivo del catálogo y detalle opcional.
- SBO con organización del catálogo.
- Inventario: condición, reubicación desde la lista de ubicaciones y edición para Coordinador y Administrador.

**Pruebas:** backend 23 de 23 (4 nuevas con unas 40 verificaciones); frontend 17 de 17; navegador 25 de 25.

## Fase D1 · Inventario e historial (31/10/2026, desplegada)

Sin cambios en la base de datos.

**Decisiones del usuario:** los productos que llegan a 0 unidades se conservan; dividir un producto entre ubicaciones queda para después de la Fase G; la exportación a Excel está pendiente de confirmar si se necesita.

**API** (detalle en `docs/API.md`)
- `GET /productos?pagina=`: búsqueda, filtros (categoría, ubicación, condición, sin ubicar, bajo stock mínimo, activos/inactivos), orden y paginación, con Total / Reservado / Libre y última actualización.
- `GET /productos/:id/kardex`: movimientos con saldo acumulado, SBO en curso y aviso si el historial no coincide con el stock.
- Inactivar y activar con justificación (`productos:inactivar`, Coordinador y Administrador). El borrado físico es solo del Administrador y solo para productos sin movimientos.
- `GET /historial?pagina=`: filtros por fecha, código, acción, operario, SBO y texto. `GET /historial/filtros`.
- Un producto inactivo no entra en SBO nuevas.
- El verificador de consistencia reconoce EDICIÓN, INACTIVACIÓN y ACTIVACIÓN, los productos agotados que se conservan y la zona de cada ubicación.

**Frontend**
- Inventario con filtros, resumen de unidades, paginación en el servidor, detalle con kardex e inactivar/activar.
- Historial con filtros en la URL y enlaces al producto y a la SBO.

**Pruebas:** backend 29 de 29 (22 de integración, 7 unitarias); frontend 18 de 18; navegador 25 de 25.

## Fase D2 · Ingresos y retiros como documentos (31/10/2026, desplegada)

**Base de datos:** migración `3_documentos`, solo aditiva: tablas `Documento` y `DocumentoLinea`, y la columna opcional `Historial.documentoId`. No modifica ni borra datos.

**Decisiones del usuario:** cada condición tiene su propio código de producto; la fecha del documento es siempre la del registro; la numeración es un consecutivo sin año (`ING-0001`, `SAL-0001`); la exportación a Excel queda como complemento para después.

**API** (detalle en `docs/API.md`)
- `POST /documentos/ingreso` y `POST /documentos/salida`: varias líneas en una sola transacción. Si una línea falla no se guarda nada, y el error dice qué línea fue.
- Cada línea tiene una unidad de manejo del catálogo (p. ej. 2 cajas × 20 = 40 unidades).
- Un ingreso puede crear productos nuevos y tiene origen (Donación o Compra), donante o proveedor opcional y documento soporte.
- Una salida tiene motivo y organización destino opcional.
- `GET /documentos?pagina=` (filtros por tipo, fechas y texto) y `GET /documentos/:id` (por id o por número).
- El historial y el kardex traen el número del documento de cada movimiento.
- `POST /productos` y `POST /salida` siguen funcionando igual; comparten la lógica con los documentos (`lib/movimientos.js`).
- El verificador lee la ubicación inicial de un producto nuevo creado fuera de Recepción.
- Corrección: la consulta SQL directa que bloquea el producto (`lib/stock.js`) ahora nombra la tabla con su esquema. Con el pooler de Supabase en modo transacción, en `smi_pruebas` a veces leía la tabla de `public`, y las pruebas fallaban de forma intermitente. En producción no tenía efecto, porque allí el esquema es `public`.

**Frontend**
- "Ingresos y Retiros" con tres pestañas: Nuevo ingreso, Nueva salida y Documentos.
- Líneas con autocompletar que muestra la condición y el stock (libre, en las salidas).
- "Producto nuevo" y "Otra condición" (copia los datos del artículo con otro código) sin salir del documento.
- Confirmación con el resumen de líneas y unidades antes de guardar.
- Comprobante imprimible o en PDF con firmas de entrega y recibido, enlazado desde el historial y el kardex.

**Pruebas:** backend 33 de 33 (25 de integración, 8 unitarias); frontend 22 de 22; navegador 25 de 25, más el comprobante impreso a PDF y revisado.

## Fase D3 · Solicitudes SBO (31/10/2026, EN PRUEBAS: falta que la suite del backend pase completa y la prueba en navegador; sin desplegar)

**Base de datos:** migración aditiva `4_sbo_vencimiento`: agrega el estado `VENCIDA` y la columna opcional `Solicitud.fecha_vencimiento`.

**Backend**
- Código automático `SBO-0001`, `GET /solicitudes/siguiente-codigo` y reintento si dos solicitudes se crean a la vez.
- Lista paginada con filtros: estado o en curso, organización, alistador, fechas, texto, atrasadas y por vencer. Trae el resumen de atrasadas y por vencer.
- Campos calculados: atrasada, días sin movimiento, vencimiento, tiempos y meta de alistamiento, y por ítem la referencia `SBO-0001-<código>`, lo reservado y lo despachado.
- Vencimiento automático a los 30 días sin movimiento (libera la reserva), aviso 5 días antes y acción **Renovar**. Parámetros configurables.
- Nota obligatoria en el alistamiento parcial.
- `GET /solicitudes/codigo/:codigo` y `GET /version` (público).
- Tarea diaria de GitHub Actions que despierta el servidor (`.github/workflows/despertar.yml`).

**Frontend**
- "Solicitudes SBO" dividida en formulario, detalle y lista (`src/pages/solicitudes/`).
- Formulario: código sugerido y aviso cuando se pide más de lo libre (se puede guardar, no aprobar).
- Lista con filtros e insignias **Atrasada** y **Vence en N días**.
- Detalle: tabla solicitado / reservado / alistado / despachado, avisos, tiempos, nota (obligatoria si el alistamiento es parcial), botón Renovar y línea de tiempo.
- Remisión imprimible con firmas (`/solicitudes/:codigo/remision`).
- En el historial, el código de una SBO abre su detalle.

**Codificación de productos:** propuesta aprobada en `docs/CODIFICACION.md` (formato `001-RCM-B`, con el estado del objeto en el sufijo). Se implementa en una subfase propia.

## Fase D4: Dashboard (02/11/2026)

- `GET /api/dashboard` reúne en una consulta los indicadores del panel, con las mismas reglas que las listas: unidades totales, libres y reservadas; productos sin ubicar, bajo mínimo y agotados; SBO por estado, en curso, atrasadas y por vencer.
- Unidades por categoría y por zona, ubicaciones del catálogo ocupadas, alertas (SBO y productos, hasta 6 de cada tipo) y los 8 últimos movimientos.
- El panel enlaza cada alerta a su lista ya filtrada: `/inventario?sinUbicar=1`, `/inventario?bajoMinimo=1`, `/solicitudes?atrasada=1`, `/solicitudes?porVencer=1` y `/solicitudes?estado=<ESTADO>`.
- Sin cambios en la base de datos.

## Mapa de Bodega (02/11/2026)

- Migración `5_estantes` (aditiva): tabla `Estanteria` y `Ubicacion.estanteriaId`.
- Configuración → Estanterías: crear, editar (calle, niveles, huecos, orden) y desactivar racks. Al guardar se generan sus huecos `Z1-A-2-04`. Botón para cargar la distribución inicial (`npm run estanterias:iniciales` hace lo mismo).
- `/inventario-mapa`: racks de cada zona como cuadrícula nivel × hueco (sin capacidad), áreas, panel de detalle con Reubicar, Kardex e Ingresar aquí, búsqueda "¿Dónde está?" y lista de productos fuera de estanterías.
- "Ingresar aquí" abre el documento de ingreso con esa ubicación para los productos nuevos (`/movimientos?pestana=ingreso&ubicacion=`).

## Codificación de productos 001-RCM-B (02/11/2026)

- Migración `6_codificacion` (aditiva): `Categoria.letra` y `nombre_variante`, tablas `Subcategoria` y `Variante`, y `Producto.subcategoriaId` / `varianteId`.
- El sistema asigna el consecutivo por base (`GET /api/codificacion/siguiente`); el sufijo sale de la condición (P, B, D, X). El mismo artículo en otra condición conserva la base y cambia solo el sufijo.
- Configuración → Codificación: letras de categoría, subcategorías y nivel 3 (variantes), con botón para cargar el árbol propuesto (12 categorías; Textiles → Ropa, Hogar → Cocina y menaje, Aseo no perecedero → Higiene personal, Papelería → Escolar y papelería, Juguetes → Juguetes y recreación).
- Producto nuevo: al elegir una categoría con letra pide subcategoría y nivel 3 y muestra el código calculado (solo lectura).
- Un producto codificado no cambia de categoría ni de condición al editarlo.

## Fase E: Novedades y trazabilidad (02/11/2026, sin desplegar: se publica al terminar la ronda de testers)

- Migración `7_novedades` (aditiva): tabla `Novedad` (`NOV-0001`), enum `TipoNovedad` y en `SolicitudItem` `cantidad_devuelta` y `codigo_original`.
- Novedades por ítem de SBO: faltante, artículo dañado, talla no disponible y otro (con motivo opcional del catálogo, tipo NOVEDAD). El alistamiento parcial crea los faltantes por sí solo.
- Sustitución durante la aprobación o el alistamiento: mueve la reserva al producto sustituto.
- Devolución después del despacho: las unidades vuelven al stock; el verificador de consistencia la suma como ingreso.
- Página **Novedades** con filtros, resumen por tipo y exportación a CSV (Excel).
- Página **Trazabilidad** (`/trazabilidad?codigo=`): línea de tiempo de un producto o una SBO. Enlaces desde el detalle de la SBO, las novedades y el kardex.

## Pendiente (en orden)

- **F** Indicadores.
- **G** Conciliación (requiere BD).
- **H** Calidad y entrega.
