# API de SMI-ControlBAB

Base: `/api`. Todas las respuestas son JSON. Los errores tienen la forma `{ "error": "mensaje en español", "codigo": "OPCIONAL" }`.

En producción el frontend llama a `/api/*` en su propio dominio (Vercel) y Vercel lo reenvía a Render. Así la cookie de sesión es de primera parte.

## Autenticación

- **Token de acceso:** JWT HS256 de 15 min (`ACCESO_MINUTOS`). Se envía en `Authorization: Bearer <token>` y el frontend lo guarda solo en memoria.
- **Sesión (refresh):** cookie `smi_sesion` (httpOnly, SameSite=Strict, `path=/api/auth`, Secure). Dura 10 h (`SESION_HORAS`) y rota en cada renovación. En la base solo se guarda su hash SHA-256.
- Si se reutiliza una cookie ya rotada (más de 30 s después), se considera robada y se cierran **todas** las sesiones de ese usuario.
- El usuario se vuelve a leer de la base en cada petición, así que desactivarlo o cambiarle el rol aplica de inmediato.

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| POST | `/auth/login` | `{ usuario, password }` | `{ accessToken, usuario }` y la cookie de sesión. |
| POST | `/auth/refresh` | — (usa la cookie) | `{ accessToken, usuario }` y una cookie nueva. |
| POST | `/auth/logout` | — | Revoca la sesión y borra la cookie. |
| GET | `/auth/yo` | — | El usuario actual. |
| POST | `/auth/cambiar-password` | `{ actual, nueva }` | `{ accessToken, usuario }`. Cierra las demás sesiones del usuario. |

- `usuario` lleva `{ id, nombre, usuario, rol, activo, debe_cambiar_password, ultimo_acceso, permisos[] }` y nunca el hash.
- **Política de contraseña:** de 10 a 72 caracteres, con letras y números, y distinta de la actual.
- **Límites:** tras 5 intentos fallidos el usuario queda bloqueado 15 min (423 `USUARIO_BLOQUEADO`). Cada IP admite 20 intentos fallidos cada 15 min (429).

**Códigos de error:**

| Código | HTTP | Qué hace el frontend |
|---|---|---|
| `SIN_SESION`, `TOKEN_VENCIDO`, `TOKEN_INVALIDO` | 401 | Renueva la sesión una vez y repite la petición. |
| `USUARIO_INACTIVO` | 401 | Cierra la sesión. |
| `DEBE_CAMBIAR_PASSWORD` | 403 | Bloquea todo menos `/auth/*`. |
| `SIN_PERMISO` | 403 | Muestra el error de permiso. |
| `CREDENCIALES_INVALIDAS` | 401 | Muestra el error de login. |
| `SESION_VENCIDA` | 401 | Pide iniciar sesión de nuevo. |

## Roles y permisos

La matriz está en `auth/permisos.js`. El frontend recibe `permisos[]` y solo lo usa para ocultar botones; quien decide siempre es el backend.

| Permiso | Administrador | Coordinador | Operario | Consulta |
|---|:-:|:-:|:-:|:-:|
| `inventario:ver` (todas las consultas) | ✔ | ✔ | ✔ | ✔ |
| `movimientos:registrar` (ingreso, salida) | ✔ | ✔ | ✔ | |
| `productos:reubicar` | ✔ | ✔ | ✔ | |
| `productos:eliminar` | ✔ | ✔ | | |
| `productos:editar` (descripción, categoría, talla, condición, stock mínimo, activo) | ✔ | ✔ | | |
| `sbo:crear` (crear, editar ítems) | ✔ | ✔ | ✔ | |
| `sbo:alistar` (iniciar y finalizar alistamiento) | ✔ | ✔ | ✔ | |
| `sbo:aprobar` | ✔ | ✔ | | |
| `sbo:despachar` | ✔ | ✔ | | |
| `sbo:cancelar` | ✔ | ✔ | | |
| `configuracion:gestionar` (catálogos y parámetros) | ✔ | ✔ | | |
| `usuarios:gestionar` | ✔ | | | |

- Solo pueden ser alistadores los usuarios activos con rol Operario o Coordinador.
- El autor de cada movimiento (`Historial.operario` y `Historial.usuarioId`) sale de la sesión, nunca del cuerpo de la petición.

## Usuarios

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| GET | `/usuarios/alistadores` | `inventario:ver` | Devuelve `[{ usuario, nombre, rol }]` de los activos. |
| GET | `/usuarios` | `usuarios:gestionar` | Lista sin hashes. |
| POST | `/usuarios` | `usuarios:gestionar` | Recibe `{ nombre, usuario, rol }` y devuelve `{ usuario, passwordTemporal }`. La contraseña temporal se muestra **una sola vez**. Un usuario repetido da 409, sin importar mayúsculas. |
| PATCH | `/usuarios/:id` | `usuarios:gestionar` | Recibe `{ nombre?, rol?, activo? }`. Nadie puede desactivarse ni quitarse el rol de administrador a sí mismo, y siempre debe quedar al menos un administrador activo (409). Desactivar cierra las sesiones del usuario. |
| POST | `/usuarios/:id/restablecer` | `usuarios:gestionar` | Genera una contraseña temporal nueva, obliga a cambiarla, desbloquea al usuario y cierra sus sesiones. |

## Inventario y SBO

Exigen sesión y permiso. Desde la Fase C, la categoría, la ubicación, el motivo de salida y la organización deben existir **activos** en su catálogo. Se envían por id o por nombre (sin distinguir mayúsculas). Si no existen, la respuesta es 400.

| Ruta | Permiso |
|---|---|
| GET `/productos`, `/historial`, `/solicitudes`, `/solicitudes/:id` | `inventario:ver` |
| POST `/productos` (ingreso): `{ codigo_producto, descripcion, cantidad, categoriaId \| categoria, ubicacion_general?, condicion?, talla?, grupo?, stock_minimo? }` | `movimientos:registrar` |
| POST `/salida`: `{ codigo_producto, cantidad_retirada, motivoId \| motivo, detalle? }` (motivo de tipo SALIDA) | `movimientos:registrar` |
| PUT `/productos/:id` (reubicar): `{ codigo_estanteria }` con el código de una ubicación del catálogo | `productos:reubicar` |
| PATCH `/productos/:id` (editar datos, queda EDICIÓN en el historial) | `productos:editar` |
| DELETE `/productos/:id` | `productos:eliminar` |
| POST `/solicitudes`: `{ codigo_sbo, organizacionId \| beneficiario, items, … }` | `sbo:crear` |
| PUT `/solicitudes/:id/items` | `sbo:crear` |
| POST `/solicitudes/:id/transicion` | Según la acción: `aprobar` pide `sbo:aprobar`; `iniciar` y `finalizar` piden `sbo:alistar`; `despachar` pide `sbo:despachar`; `cancelar` pide `sbo:cancelar`. |

- `POST /historial` se eliminó: el historial solo lo escribe el backend.
- `GET /productos` devuelve en `categoria` el nombre vigente del catálogo, además de `categoriaId`, `talla`, `condicion`, `grupo`, `stock_minimo` y `activo`.
- Un producto inactivo no recibe ingresos (409).

## Catálogos (Fase C)

`:catalogo` puede ser `categorias`, `organizaciones`, `terceros` (donantes y proveedores), `motivos`, `unidades` o `ubicaciones`. Los registros **no se borran**: se desactivan con `{ "activo": false }`.

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| GET | `/catalogos/opciones` | `inventario:ver` | Listas fijas: `condiciones`, `grupos`, `tiposTercero`, `tiposMotivo`. |
| GET | `/catalogos/:catalogo` | `inventario:ver` | `?activos=1` devuelve solo los activos. `?tipo=SALIDA` filtra motivos; `?tipo=DONANTE` o `PROVEEDOR` filtra terceros, incluidos los que son AMBOS. Las categorías traen el conteo de `productos`. |
| POST | `/catalogos/:catalogo` | `configuracion:gestionar` | Valida cada campo; un nombre repetido da 409, sin importar mayúsculas. |
| PATCH | `/catalogos/:catalogo/:id` | `configuracion:gestionar` | Edición parcial. El tipo de un motivo no se cambia. Una ubicación con productos no se desactiva ni cambia de código (409). Renombrar una categoría actualiza el texto en sus productos. |
| GET | `/catalogos/categorias/:id/siguiente-codigo` | `inventario:ver` | Devuelve `{ codigo: "ROP-006" }`, o `null` si la categoría no tiene prefijo. |

**Campos por catálogo:**
- categorías: `nombre*`, `prefijo` (2 a 5 letras), `descripcion`;
- organizaciones: `nombre*`, `nit`, `contacto`, `telefono`, `correo`, `localidad`, `direccion`;
- terceros: `tipo*` (DONANTE, PROVEEDOR o AMBOS), `nombre*`, `nit`, `contacto`, `telefono`, `correo`;
- motivos: `tipo*` (SALIDA, AJUSTE o NOVEDAD), `nombre*`;
- unidades: `nombre*`, `abreviatura`, `factor*` (unidades que equivale);
- ubicaciones: `codigo*`, `nombre`, `zona`, `estante`, `nivel`, `posicion`.

## Parámetros

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| GET | `/parametros` | `inventario:ver` | Devuelve `[{ clave, etiqueta, valor, defecto, min, max }]`. |
| PUT | `/parametros` | `configuracion:gestionar` | Recibe `{ clave: valor }`. Una clave desconocida da 400. El lote pequeño debe ser menor que el mediano. |

Claves disponibles:
- `tiempo_meta_alistamiento_horas` (24);
- `dias_atraso_sbo` (0);
- `stock_minimo_defecto` (5);
- `lote_pequeno_max` (10);
- `lote_mediano_max` (50).

## Ubicaciones para el Mapa de Bodega (solo lectura)

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| GET | `/ubicaciones` | `inventario:ver` | `[{ id, codigo, nombre, zona, estante, nivel, posicion, activo, productos, unidades }]`. Por defecto solo las activas; `?todas=1` las incluye todas. |
| GET | `/ubicaciones/:codigo/contenido` | `inventario:ver` | `{ ubicacion, productos: [{ id, codigo_producto, descripcion, categoria, cantidad, cantidad_reservada, condicion, talla, activo }], unidades }`. Si no existe, 404. |

Un producto está en la ubicación de su `codigo_estanteria`. Si no tiene estantería asignada, está en su `ubicacion_general` (por ejemplo, Recepción).
- El campo `operario` ya no se acepta en ninguna petición.
