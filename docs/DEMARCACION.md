# Propuesta de demarcación de la bodega

**Estado:** propuesta, pendiente de que la bodega la valide (02/11/2026).

Todas las etiquetas se imprimen desde el programa y salen de los mismos datos que usa el Mapa de Bodega. Se abren desde:
- el Mapa de Bodega, con el botón "Demarcación y etiquetas";
- Configuración → Estanterías.

La ruta es `/demarcacion`, y se filtra por zona y por rack (`?zona=Z1&rack=Z1-A`).

## 1. Código de cada hueco

`Z1-A-2-04` = Zona 1, rack A, nivel 2, hueco 4.

Es el código que pide el programa al ingresar, reubicar, contar o buscar. La etiqueta del hueco lleva:
- el código en grande;
- un código de barras Code 128 (cualquier lector USB lo "escribe" en el buscador);
- el detalle en palabras.

## 2. Qué se marca y dónde

| Elemento | Qué es | Dónde va |
|---|---|---|
| Letrero del rack | Una hoja por rack: franja con el color de la zona, la letra en grande, el código (Z1-A), la calle y cuántos huecos hay por nivel. | En la cabecera del rack que da al pasillo, a la altura de la vista o colgado arriba, para encontrarlo desde la calle. |
| Etiqueta de nivel | "NIVEL 2" con el código del rack y cuántos huecos tiene ese nivel. | En el extremo izquierdo de la viga de cada nivel. Los niveles se cuentan de abajo hacia arriba (1 = el más bajo). |
| Etiqueta de hueco | Código, código de barras y detalle. | Centrada en la viga frontal, debajo del hueco. Los huecos se cuentan de izquierda a derecha, mirando el rack desde el pasillo. En el nivel 1 va en la viga de arriba o en el piso. |
| Piso | Cinta amarilla en los bordes de calles y pasillos. | Las mesas de alistamiento se marcan con franjas diagonales y el letrero "Zona de alistamiento: no almacenar". |

## 3. Colores por zona

La franja del letrero y el borde de las etiquetas indican la zona:

| Zona | Color |
|---|---|
| Zona 1 | Azul marino |
| Zona 2 | Naranja |
| Zona 3 | Verde |
| Zona 4 y siguientes | Morado, rojo y turquesa |

Las fórmulas están en `colorZona`, en `SMI-Frontend/src/lib/plano.js`.

## 4. Materiales sugeridos

- Papel adhesivo, protegido con cinta transparente.
- O porta-etiquetas magnéticos o de plástico para la viga, que permiten cambiar la etiqueta sin despegarla.
- El letrero del rack se imprime en hoja carta, uno por página.

## 5. Mantenimiento

Si se cambia un rack en Configuración → Estanterías (niveles, huecos o "huecos desde el nivel 2"), hay que volver a imprimir sus etiquetas. Para eso se filtra la página por ese rack.

Los huecos que sobran se desactivan y no se borran, así que una etiqueta vieja de un hueco que ya no existe no se puede usar en el programa.

## Pendiente de confirmar con la bodega

- Las letras de los racks en el plano (SUPUESTOS #68).
- En qué racks hay un hueco de más del nivel 2 hacia arriba (#67). Hoy se aplica a todos los racks de la Zona 1, y los testers dijeron "en algunos".
- La altura del letrero y si se prefiere colgarlo.
