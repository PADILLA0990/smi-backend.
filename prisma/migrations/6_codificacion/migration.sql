-- Codificación de productos 001-RCM-B (aditiva): letra de categoría, subcategorías (nivel 2) y variantes (nivel 3)
-- AlterTable
ALTER TABLE "Categoria" ADD COLUMN     "letra" TEXT,
ADD COLUMN     "nombre_variante" TEXT;

-- AlterTable
ALTER TABLE "Producto" ADD COLUMN     "subcategoriaId" INTEGER,
ADD COLUMN     "varianteId" INTEGER;

-- CreateTable
CREATE TABLE "Subcategoria" (
    "id" SERIAL NOT NULL,
    "categoriaId" INTEGER NOT NULL,
    "letra" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subcategoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variante" (
    "id" SERIAL NOT NULL,
    "categoriaId" INTEGER NOT NULL,
    "letra" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variante_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subcategoria_categoriaId_letra_key" ON "Subcategoria"("categoriaId", "letra");

-- CreateIndex
CREATE UNIQUE INDEX "Variante_categoriaId_letra_key" ON "Variante"("categoriaId", "letra");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_letra_key" ON "Categoria"("letra");

-- CreateIndex
CREATE INDEX "Producto_subcategoriaId_idx" ON "Producto"("subcategoriaId");

-- CreateIndex
CREATE INDEX "Producto_varianteId_idx" ON "Producto"("varianteId");

-- AddForeignKey
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_subcategoriaId_fkey" FOREIGN KEY ("subcategoriaId") REFERENCES "Subcategoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "Variante"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subcategoria" ADD CONSTRAINT "Subcategoria_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variante" ADD CONSTRAINT "Variante_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

