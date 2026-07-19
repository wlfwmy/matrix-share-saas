import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.user.upsert({
    where: { email: 'dev@example.com' },
    update: {},
    create: { id: 'dev_user', email: 'dev@example.com', password: 'dev' },
  });
  const users = await prisma.user.findMany();
  console.log('Users:', JSON.stringify(users.map(u => ({ id: u.id, email: u.email }))));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
