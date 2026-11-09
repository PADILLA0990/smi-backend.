-- Casilla "Lleno" de los huecos de rack: planta decide cuándo un hueco ya no recibe producto
ALTER TABLE "Ubicacion" ADD COLUMN "lleno" BOOLEAN NOT NULL DEFAULT false;
