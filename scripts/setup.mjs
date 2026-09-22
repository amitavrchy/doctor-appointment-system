import { randomBytes } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
if (!(await exists('.env'))) {
  let text = await readFile('.env.example', 'utf8');
  for (const key of [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'OTP_PEPPER',
    'ATTACHMENT_ENCRYPTION_KEY',
  ])
    text = text.replace(
      new RegExp(`^${key}=.*$`, 'm'),
      `${key}=${randomBytes(32).toString('hex')}`,
    );
  await writeFile('.env', text, { flag: 'wx' });
  console.log('Created local .env with independent random secrets.');
}
if (!(await exists('backend/.env'))) {
  await writeFile('backend/.env', await readFile('.env'), { flag: 'wx' });
  console.log('Configured backend/.env.');
}
console.log(
  'Configuration ready. Start Postgres/Redis, then generate, migrate and seed. Existing configuration was retained.',
);
