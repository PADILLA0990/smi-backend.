-- CreateEnum
CREATE TYPE "Condicion" AS ENUM ('PERFECTO', 'BUENO', 'DETERIORO', 'DANADO');

-- CreateEnum
CREATE TYPE "TipoTercero" AS ENUM ('DONANTE', 'PROVEEDOR', 'AMBOS');

-- CreateEnum
CREATE TYPE "TipoMotivo" AS ENUM ('SALIDA', 'AJUSTE', 'NOVEDAD');

-- AlterTable
ALTER TABLE "Producto" ADD COLUMN     "activo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "categoriaId" INTEGER,
ADD COLUMN     "condicion" "Condicion",
ADD COLUMN     "grupo" TEXT,
ADD COLUMN     "stock_minimo" INTEGER,
ADD COLUMN     "talla" TEXT;

-- AlterTable
ALTER TABLE "Solicitud" ADD COLUMN     "organizacionId" INTEGER;

-- CreateTable
CREATE TABLE "Categoria" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "prefijo" TEXT,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organizacion" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "nit" TEXT,
    "contacto" TEXT,
    "telefono" TEXT,
    "correo" TEXT,
    "localidad" TEXT,
    "direccion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tercero" (
    "id" SERIAL NOT NULL,
    "tipo" "TipoTercero" NOT NULL DEFAULT 'DONANTE',
    "nombre" TEXT NOT NULL,
    "nit" TEXT,
    "contacto" TEXT,
    "telefono" TEXT,
    "correo" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tercero_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Motivo" (
    "id" SERIAL NOT NULL,
    "tipo" "TipoMotivo" NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Motivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnidadManejo" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "abreviatura" TEXT,
    "factor" INTEGER NOT NULL DEFAULT 1,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnidadManejo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ubicacion" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT,
    "zona" TEXT,
    "estante" TEXT,
    "nivel" TEXT,
    "posicion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ubicacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parametro" (
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Parametro_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_nombre_key" ON "Categoria"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_prefijo_key" ON "Categoria"("prefijo");

-- CreateIndex
CREATE UNIQUE INDEX "Organizacion_nombre_key" ON "Organizacion"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Organizacion_nit_key" ON "Organizacion"("nit");

-- CreateIndex
CREATE UNIQUE INDEX "Tercero_nombre_key" ON "Tercero"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Tercero_nit_key" ON "Tercero"("nit");

-- CreateIndex
CREATE UNIQUE INDEX "Motivo_tipo_nombre_key" ON "Motivo"("tipo", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "UnidadManejo_nombre_key" ON "UnidadManejo"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Ubicacion_codigo_key" ON "Ubicacion"("codigo");

-- CreateIndex
CREATE INDEX "Producto_categoriaId_idx" ON "Producto"("categoriaId");

-- CreateIndex
CREATE INDEX "Solicitud_organizacionId_idx" ON "Solicitud"("organizacionId");

-- AddForeignKey
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Solicitud" ADD CONSTRAINT "Solicitud_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Valores iniciales de los catálogos (editables desde Configuración; no tocan productos existentes)
INSERT INTO "Categoria" ("nombre", "prefijo", "actualizado_en") VALUES
  ('Textiles', 'ROP', CURRENT_TIMESTAMP),
  ('Papelería', 'APP', CURRENT_TIMESTAMP),
  ('Calzado', 'CAL', CURRENT_TIMESTAMP),
  ('Hogar', 'HOG', CURRENT_TIMESTAMP),
  ('Juguetes', 'JUG', CURRENT_TIMESTAMP),
  ('Aseo no perecedero', 'ASE', CURRENT_TIMESTAMP),
  ('Otros', 'OTR', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "Motivo" ("tipo", "nombre", "actualizado_en") VALUES
  ('SALIDA', 'Entrega a organización beneficiaria', CURRENT_TIMESTAMP),
  ('SALIDA', 'Entrega directa a persona o comunidad', CURRENT_TIMESTAMP),
  ('SALIDA', 'Traslado a otra sede', CURRENT_TIMESTAMP),
  ('SALIDA', 'Baja por daño o deterioro', CURRENT_TIMESTAMP),
  ('SALIDA', 'Otro', CURRENT_TIMESTAMP),
  ('AJUSTE', 'Sobrante en conteo físico', CURRENT_TIMESTAMP),
  ('AJUSTE', 'Faltante en conteo físico', CURRENT_TIMESTAMP),
  ('AJUSTE', 'Corrección de error de registro', CURRENT_TIMESTAMP),
  ('AJUSTE', 'Otro', CURRENT_TIMESTAMP),
  ('NOVEDAD', 'Daño o deterioro', CURRENT_TIMESTAMP),
  ('NOVEDAD', 'Pérdida', CURRENT_TIMESTAMP),
  ('NOVEDAD', 'Humedad o plagas', CURRENT_TIMESTAMP),
  ('NOVEDAD', 'Diferencia en recepción', CURRENT_TIMESTAMP),
  ('NOVEDAD', 'Otro', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "UnidadManejo" ("nombre", "abreviatura", "factor", "actualizado_en") VALUES
  ('Unidad', 'und', 1, CURRENT_TIMESTAMP),
  ('Par', 'par', 1, CURRENT_TIMESTAMP),
  ('Paquete', 'paq', 10, CURRENT_TIMESTAMP),
  ('Caja', 'cja', 20, CURRENT_TIMESTAMP),
  ('Paca', 'pca', 50, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "Ubicacion" ("codigo", "nombre", "zona", "actualizado_en") VALUES
  ('Recepción', 'Zona de recepción de donaciones', 'Recepción', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
