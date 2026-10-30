// Crea las cuentas iniciales si no existen: un Administrador y los operarios que ya usaban el sistema.
// Las contraseñas temporales se generan al azar y se escriben en credenciales-iniciales.txt
// (fuera de git) para entregarlas en persona. Todos deben cambiarlas en su primer ingreso.
//
// Uso: node scripts/crear-usuarios-iniciales.js
// Es idempotente: si un usuario ya existe, no lo toca.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const prisma = require('../lib/prisma');
const { cifrarPassword, generarPasswordTemporal } = require('../auth/credenciales');

const INICIALES = [
  { usuario: 'admin', nombre: 'Administrador SMI', rol: 'ADMINISTRADOR' },
  { usuario: 'Operario01', nombre: 'Operario 01', rol: 'OPERARIO' },
  { usuario: 'Operario02', nombre: 'Operario 02', rol: 'OPERARIO' }
];

const ARCHIVO = path.join(__dirname, '..', 'credenciales-iniciales.txt');

async function main() {
  const lineas = [];
  for (const datos of INICIALES) {
    const existente = await prisma.usuario.findFirst({ where: { usuario: { equals: datos.usuario, mode: 'insensitive' } } });
    if (existente) {
      console.log(`· ${datos.usuario}: ya existe, no se modifica`);
      continue;
    }
    const passwordTemporal = generarPasswordTemporal();
    await prisma.usuario.create({
      data: { ...datos, password_hash: await cifrarPassword(passwordTemporal), debe_cambiar_password: true }
    });
    lineas.push(`${datos.usuario.padEnd(12)} ${datos.rol.padEnd(14)} ${passwordTemporal}`);
    console.log(`✔ ${datos.usuario} creado (${datos.rol})`);
  }

  if (lineas.length > 0) {
    const encabezado = `\n# Contraseñas temporales generadas el ${new Date().toISOString()}\n# Entréguelas en persona y borre este archivo. Deben cambiarse en el primer ingreso.\n`;
    fs.appendFileSync(ARCHIVO, encabezado + lineas.join('\n') + '\n', { mode: 0o600 });
    console.log(`\nContraseñas temporales guardadas en ${ARCHIVO}`);
  }
}

main()
  .catch(err => { console.error('Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
