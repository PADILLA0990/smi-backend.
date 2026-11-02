# Codificación de productos (aprobada el 31/10/2026, implementada el 02/11/2026)

## Formato

```
001 - R C M - B
 │    │ │ │   └─ Estado del objeto (P, B, D, X)
 │    │ │ └───── Nivel 3: variante (depende de la categoría)
 │    │ └─────── Nivel 2: subcategoría
 │    └───────── Nivel 1: categoría
 └────────────── Consecutivo (001–999) dentro de la combinación de letras
```

- Ejemplo: `001-RCM-B` = Ropa › Camisas y blusas › Mujer, en **Buen estado**.
- La misma prenda en otro estado comparte la base y cambia solo el sufijo:
  - `001-RCM-B` y `001-RCM-D` son el mismo artículo, en Buen estado y En deterioro.
  - Cada estado lleva su propio stock, como hoy con "Otra condición".
- Al registrar un producto se eligen las tres letras y el estado; el sistema asigna el consecutivo.
- Las letras se administran en Configuración, así que se pueden agregar o renombrar sin cambiar el programa.
- No hay fechas de vencimiento: todo es no perecedero.

## Estado del objeto (sufijo)

| Letra | Estado |
|---|---|
| P | Perfecto estado (nuevo o como nuevo) |
| B | Buen estado |
| D | En deterioro (usable, con desgaste o arreglo menor) |
| X | Dañado (no se entrega; pendiente de reparación o descarte) |

## Árbol de categorías

Cada categoría tiene una subcategoría **O = Otros** para lo que no encaje.

### R · Ropa
- **Nivel 2:**
  - C Camisas y blusas
  - P Pantalones y faldas
  - A Abrigos y chaquetas
  - I Ropa interior y medias
  - D Deportiva
  - U Uniformes
  - O Otros
- **Nivel 3, público:** H Hombre · M Mujer · N Niño/a · B Bebé · U Unisex

### Z · Calzado
- **Nivel 2:**
  - Z Zapatos
  - T Tenis
  - B Botas
  - S Sandalias
  - O Otros
- **Nivel 3, público:** H · M · N · B · U (igual que Ropa)

### T · Textiles del hogar
- **Nivel 2:**
  - C Cobijas
  - S Sábanas y fundas
  - T Toallas
  - A Almohadas
  - L Colchonetas
  - O Otros
- **Nivel 3, tamaño:** I Infantil · S Sencillo · D Doble · G Grande (queen/king) · U Única

### H · Higiene personal
- **Nivel 2:**
  - J Jabón
  - C Champú y acondicionador
  - D Cuidado dental
  - E Desodorante
  - F Higiene femenina
  - P Papel higiénico
  - A Afeitado
  - O Otros
- **Nivel 3, presentación:** I Individual · P Paquete · K Kit · G Granel

### B · Bebé
- **Nivel 2:**
  - P Pañales
  - T Toallitas húmedas
  - A Alimentación (teteros, vasos)
  - C Coches y cargadores
  - O Otros
- **Nivel 3, etapa o talla:** R Recién nacido · P Pequeño · M Mediano · G Grande · U Única

### A · Aseo del hogar
- **Nivel 2:**
  - D Detergentes
  - L Limpiadores y desinfectantes
  - U Utensilios (escobas, traperos)
  - P Papel y desechables (servilletas, toallas de cocina)
  - B Bolsas
  - O Otros
- **Nivel 3, presentación:** I · P · K · G (igual que Higiene)

### C · Cocina y menaje
- **Nivel 2:**
  - O Ollas y sartenes
  - V Vajilla
  - C Cubiertos
  - U Utensilios
  - R Recipientes
  - E Electrodomésticos pequeños
  - X Otros
- **Nivel 3, material:** M Metal · P Plástico · V Vidrio o cerámica · E Eléctrico · X Mixto

### M · Muebles
- **Nivel 2:**
  - S Sillas
  - M Mesas
  - C Camas y colchones
  - A Armarios y cómodas
  - E Estanterías
  - O Otros
- **Nivel 3, material:** M Madera · T Metal · P Plástico · X Mixto

### E · Escolar y papelería
- **Nivel 2:**
  - C Cuadernos
  - U Útiles
  - M Morrales y maletas
  - L Libros
  - P Papelería y calendarios
  - O Otros
- **Nivel 3, público:** N Niños · J Jóvenes · A Adultos · U General

### J · Juguetes y recreación
- **Nivel 2:**
  - J Juguetes
  - M Juegos de mesa
  - D Deportes
  - O Otros
- **Nivel 3, edad:** B Bebé · N Niño · J Joven · U General

### K · Ayuda humanitaria (kits)
- **Nivel 2:**
  - A Kit de aseo
  - C Kit de cocina
  - H Hamacas y carpas
  - L Linternas y energía
  - O Otros
- **Nivel 3, alcance:** I Individual · F Familiar · C Comunitario

### O · Otros
- **Nivel 2:** O Otros
- **Nivel 3:** U Único

## Relación con las 7 categorías actuales

| Hoy | Propuesta |
|---|---|
| Textiles | R Ropa y T Textiles del hogar |
| Papelería | E Escolar y papelería |
| Calzado | Z Calzado |
| Hogar | C Cocina y menaje y M Muebles |
| Juguetes | J Juguetes y recreación |
| Aseo no perecedero | H Higiene personal y A Aseo del hogar |
| Otros | O Otros |

Además se agregan B Bebé y K Ayuda humanitaria.

## Fuentes de la investigación

- Los bancos de alimentos de Colombia reciben, además de alimentos, productos de aseo e higiene personal, y bienes y servicios para las ONG inscritas: https://en.wikipedia.org/wiki/Food_Bank_(Bogot%C3%A1) y https://www.noticiasrcn.com/colombia/que-se-puede-donar-en-los-puntos-de-acopio-de-los-bancos-de-alimentos-de-colombia-1049479
- Listas de artículos no alimentarios de bancos de alimentos en el Reino Unido y Canadá: higiene, aseo del hogar, bebé y cocina. https://norwich.foodbank.org.uk/get-help/non-food-items, https://lewishamandgreenwich.nhs.uk/lewisham-foodbank, https://www.edmontonsfoodbank.com/documents/325/Most_Needed_Items_2026_blue.pdf
- Ropa: algunas fuentes indican que la ropa usada no se recibe y que debe ser nueva o estar en muy buen estado. Conviene confirmarlo con el banco.
