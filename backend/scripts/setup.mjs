import { randomBytes } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
const envPath = new URL('.env', root);
if (!(await exists(envPath))) {
  let text = await readFile(new URL('.env.example', root), 'utf8');
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
  await writeFile(envPath, text, { flag: 'wx' });
  console.log('Created backend/.env with independent random secrets.');
}
const frontendEnv = new URL('../../frontend/.env.local', import.meta.url);
if (!(await exists(frontendEnv)))
  await writeFile(
    frontendEnv,
    'API_INTERNAL_URL=http://localhost:4000\nNEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=\n',
    { flag: 'wx' },
  );
console.log('Configuration ready. Existing settings were retained.');
