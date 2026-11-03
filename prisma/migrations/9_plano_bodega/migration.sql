-- CreateEnum
CREATE TYPE "TipoElementoPlano" AS ENUM ('AREA', 'ENTRADA', 'PUERTA', 'CALLE', 'PC', 'PASO');

-- AlterTable
ALTER TABLE "Estanteria" ADD COLUMN     "huecos_superiores" INTEGER,
ADD COLUMN     "plano_vertical" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "plano_x" DOUBLE PRECISION,
ADD COLUMN     "plano_y" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ElementoPlano" (
    "id" SERIAL NOT NULL,
    "zona" TEXT NOT NULL,
    "tipo" "TipoElementoPlano" NOT NULL,
    "etiqueta" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "ancho" DOUBLE PRECISION NOT NULL,
    "alto" DOUBLE PRECISION NOT NULL,
    "ubicacion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElementoPlano_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ElementoPlano_zona_idx" ON "ElementoPlano"("zona");

