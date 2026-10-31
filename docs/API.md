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
| `productos:inactivar` (inactivar y activar, con justificación) | ✔ | ✔ | | |
| `productos:eliminar` (borrado físico, solo productos sin movimientos) | ✔ | | | |
| `productos:editar` (descripción, categoría, talla, condición, grupo, stock mínimo) | ✔ | ✔ | | |
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
| GET `/productos/:id/kardex`, `/historial/filtros` | `inventario:ver` |
| POST `/productos` (ingreso): `{ codigo_producto, descripcion, cantidad, categoriaId \| categoria, ubicacion_general?, condicion?, talla?, grupo?, stock_minimo? }` | `movimientos:registrar` |
| POST `/salida`: `{ codigo_producto, cantidad_retirada, motivoId \| motivo, detalle? }` (motivo de tipo SALIDA) | `movimientos:registrar` |
| PUT `/productos/:id` (reubicar): `{ codigo_estanteria }` con el código de una ubicación del catálogo | `productos:reubicar` |
| PATCH `/productos/:id` (editar datos, queda EDICIÓN en el historial; ya no acepta `activo`) | `productos:editar` |
| POST `/productos/:id/inactivar` y `/productos/:id/activar`: `{ justificacion }` (5 a 200 caracteres) | `productos:inactivar` |
| DELETE `/productos/:id` (borrado físico) | `productos:eliminar` |
| POST `/solicitudes`: `{ codigo_sbo, organizacionId \| beneficiario, items, … }` | `sbo:crear` |
| PUT `/solicitudes/:id/items` | `sbo:crear` |
| POST `/solicitudes/:id/transicion` | Según la acción: `aprobar` pide `sbo:aprobar`; `iniciar` y `finalizar` piden `sbo:alistar`; `despachar` pide `sbo:despachar`; `cancelar` pide `sbo:cancelar`. |

- `POST /historial` se eliminó: el historial solo lo escribe el backend.
- `GET /productos` devuelve en `categoria` el nombre vigente del catálogo, además de `categoriaId`, `talla`, `condicion`, `grupo`, `stock_minimo` y `activo`.
- Un producto inactivo no recibe ingresos ni se puede incluir en una SBO (409). Sus unidades sí se pueden retirar.
- Desde la Fase D un producto que llega a 0 unidades **se conserva** (antes se borraba).

### Inventario paginado (Fase D)

`GET /productos?pagina=1` responde `{ datos, total, pagina, porPagina, resumen: { unidades, reservadas, libres } }`. Sin `pagina` devuelve la lista completa, como antes.

| Parámetro | Valores |
|---|---|
| `porPagina` | 1 a 100 (20 por defecto) |
| `q` | Texto en código o descripción |
| `categoriaId`, `ubicacion` (código), `condicion` (o `SIN`) | Filtros del catálogo |
| `sinUbicar=1`, `bajoMinimo=1` | Sin estantería asignada; libre por debajo del stock mínimo (propio o el parámetro `stock_minimo_defecto`) |
| `estado` | `activos` (por defecto), `inactivos` o `todos` |
| `orden`, `dir` | `codigo_producto`, `descripcion`, `categoria`, `condicion`, `cantidad`, `reservado`, `libre`, `ubicacion`, `ultima_actualizacion`, `fecha_ingreso`; `asc` o `desc` |

Cada producto trae además `libre`, `stock_minimo_efectivo`, `bajo_minimo` y `ultima_actualizacion` (último movimiento o el ingreso).

### Kardex

`GET /productos/:id/kardex` responde `{ producto, movimientos, reservas, saldo_historial, coincide, avisos }`:
- `movimientos`: el historial del producto en orden cronológico, cada uno con su `saldo` acumulado.
- `reservas`: SBO en curso que lo incluyen, con `reserva_stock` (falso mientras la SBO está CREADA).
- `coincide`: si el saldo según el historial es igual al stock guardado.

### Borrado físico

Solo el Administrador, y solo si el producto no tiene movimientos aparte de su ingreso inicial, ediciones o cambios de estado, nunca estuvo en una SBO y no tiene reservas. En cualquier otro caso responde 409 y se debe inactivar.

### Historial paginado (Fase D)

`GET /historial?pagina=1` responde `{ datos, total, pagina, porPagina }`, del más reciente al más antiguo. Sin `pagina` devuelve todo, como antes.

| Parámetro | Valores |
|---|---|
| `porPagina` | 1 a 100 (25 por defecto) |
| `desde`, `hasta` | `AAAA-MM-DD`, días de Bogotá (ambos incluidos) |
| `codigo` | Parte del código |
| `accion`, `operario` | Valor exacto (los existentes salen de `GET /historial/filtros`) |
| `sbo` | Código de SBO: sus eventos y sus despachos |
| `q` | Texto en código, acción, operario o detalle |

Cada registro trae `sbo` (la SBO relacionada o `null`) y `es_sbo` (si el registro es un evento de SBO y no de un producto). Desde la Fase D2 también trae `documento` (`{ id, numero }` o `null`); el kardex lo incluye en cada movimiento.

## Documentos de ingreso y salida (Fase D2)

| Ruta | Permiso |
|---|---|
| POST `/documentos/ingreso` | `movimientos:registrar` |
| POST `/documentos/salida` | `movimientos:registrar` |
| GET `/documentos?pagina=` | `inventario:ver` |
| GET `/documentos/:id` (id o número, p. ej. `ING-0001`) | `inventario:ver` |

Un documento agrupa varias líneas y se registra en **una sola transacción**: si una línea falla no se guarda nada, y el error empieza por `Línea N (código): …`. La fecha es la del registro y el número es consecutivo por tipo, sin año (`ING-0001`, `SAL-0001`). Cada línea deja su movimiento en el historial (INGRESO NUEVO, INGRESO ADICIONAL o SALIDA/RETIRO) con `documentoId` y el número al final del detalle.

**Ingreso**

```json
{
  "origen": "DONACION",
  "terceroId": 3,
  "soporte": "Remisión 123",
  "observaciones": "…",
  "lineas": [
    { "codigo_producto": "ROP-005", "cantidad": 2, "unidadId": 4 },
    { "codigo_producto": "HOG-001", "cantidad": 5, "nuevo": { "descripcion": "Linterna", "categoriaId": 5, "condicion": "PERFECTO", "talla": "", "grupo": null, "stock_minimo": null, "ubicacion_general": "Recepción" } }
  ]
}
```

- `origen`: `DONACION` o `COMPRA`. `terceroId` es opcional y debe ser donante (o "ambos") en una donación, y proveedor (o "ambos") en una compra.
- `cantidad` va en la unidad de manejo (`unidadId`, opcional). Las unidades de inventario son `cantidad × factor`.
- Sin `nuevo`, el código debe existir y estar activo (404 o 409). Con `nuevo`, el código no debe existir (409).
- **Cada condición tiene su propio código:** si se envía `condicion` y no es la del producto existente, responde 409.
- Hasta 100 líneas, de 1 a 100.000 por línea. Un código no se repite en el mismo documento (400).

**Salida**

```json
{ "motivoId": 2, "organizacionId": 7, "observaciones": "…", "lineas": [{ "codigo_producto": "ROP-005", "cantidad": 3, "unidadId": 1 }] }
```

- El motivo (tipo SALIDA) es obligatorio. La organización destino es opcional.
- Solo se retira el stock libre. Los productos inactivos se pueden retirar.

**Respuesta** (201, y también la de `GET /documentos/:id`): el documento con `tipo`, `consecutivo`, `numero`, `fecha`, `origen`, `tercero_nombre`, `soporte`, `motivo_nombre`, `organizacion_nombre`, `observaciones`, `operario` y `lineas`. Cada línea trae `codigo_producto`, `descripcion`, `condicion`, `unidad`, `factor`, `cantidad_manejo`, `cantidad` (unidades) y `producto_nuevo`. Los nombres se copian al guardar, así que el comprobante no cambia si después se edita el catálogo.

**Lista:** `GET /documentos?pagina=1` responde `{ datos, total, pagina, porPagina }`, del más reciente al más antiguo. Admite `porPagina` (25 por defecto), `tipo` (`INGRESO` o `SALIDA`), `desde` y `hasta` (`AAAA-MM-DD`, Bogotá) y `q` (número, donante, organización, soporte, operario o código de producto). En la lista, `lineas` es el número de líneas y `unidades` es el total.

`POST /productos` y `POST /salida` siguen disponibles para un solo producto, sin documento.

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
