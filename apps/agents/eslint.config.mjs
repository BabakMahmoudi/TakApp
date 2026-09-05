import baseConfig from '../../eslint.config.mjs';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([...baseConfig, globalIgnores(['.wrangler/*'])]);
