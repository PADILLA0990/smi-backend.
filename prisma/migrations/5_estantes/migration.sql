-- Mapa de Bodega: estanterías y enlace opcional de cada ubicación con su estantería (aditiva)
CREATE TABLE "Estanteria" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "zona" TEXT NOT NULL,
    "rack" TEXT NOT NULL,
    "calle" TEXT,
    "niveles" INTEGER NOT NULL,
    "huecos" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Estanteria_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Estanteria_codigo_key" ON "Estanteria"("codigo");

ALTER TABLE "Ubicacion" ADD COLUMN "estanteriaId" INTEGER;

CREATE INDEX "Ubicacion_estanteriaId_idx" ON "Ubicacion"("estanteriaId");

ALTER TABLE "Ubicacion" ADD CONSTRAINT "Ubicacion_estanteriaId_fkey" FOREIGN KEY ("estanteriaId") REFERENCES "Estanteria"("id") ON DELETE SET NULL ON UPDATE CASCADE;
