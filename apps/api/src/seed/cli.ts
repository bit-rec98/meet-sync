import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { seedRefusal } from './guard.js';
import { removeSeedData, seedDatabase } from './seed.js';
import { SEED_PASSWORD, SEED_USERS } from './seedData.js';

const USAGE = 'Usage: npm run seed   |   npm run seed:remove';

/** Command-line entry point for `npm run seed` and `npm run seed:remove` (development only). */
async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== 'seed' && command !== 'remove') {
    throw new Error(USAGE);
  }

  const config = loadConfig();
  const refusal = seedRefusal(config);
  if (refusal) throw new Error(`Refusing to run. ${refusal}`);

  const pool = createPool(config.database);
  try {
    if (command === 'remove') {
      const removed = await removeSeedData(pool);
      console.info(`Removed ${removed.users} test accounts and ${removed.meetings} meetings.`);
      return;
    }

    const report = await seedDatabase(pool);
    console.info(
      `Created ${report.users} test accounts and ${report.meetings} meetings (${report.invitations} invitations).`,
    );
    console.info(`Password for all of them: ${SEED_PASSWORD}`);
    for (const user of SEED_USERS) console.info(`  ${user.email}  (${user.displayName})`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seeding failed.');
  process.exit(1);
});
