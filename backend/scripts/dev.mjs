import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const initial = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.build.json'], {
  stdio: 'inherit',
});
if (initial.status !== 0) process.exit(initial.status || 1);
const children = [
  spawn(
    process.execPath,
    [compiler, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'],
    { stdio: 'inherit' },
  ),
  spawn(process.execPath, ['--watch', 'dist/main.js'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
for (const child of children) {
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => stop(code || 0));
}
