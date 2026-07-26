import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdir, writeFile, copyFile } from 'fs/promises';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = resolve(rootDir, 'dist');

async function build() {
  await mkdir(distDir, { recursive: true });

  try {
    // Run TypeScript compiler
    execSync('npx tsc', { stdio: 'inherit', cwd: rootDir });
    console.log('Build completed successfully.');
  } catch {
    console.error('Build failed.');
    process.exit(1);
  }
}

build();
