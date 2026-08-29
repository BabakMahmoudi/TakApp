import { FlatCompat } from '@eslint/eslintrc';
import { defineConfig, globalIgnores } from 'eslint/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const compat = new FlatCompat({
  baseDirectory: path.dirname(fileURLToPath(import.meta.url)),
});

export default defineConfig([
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  globalIgnores([
    '.next/*',
    '.open-next/*',
    '.wrangler/*',
    'next-env.d.ts',
    'public/sw.js',
    'public/manifest.webmanifest',
  ]),
]);
