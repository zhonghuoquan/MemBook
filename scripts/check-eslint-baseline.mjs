import { readFile } from 'node:fs/promises';
import { ESLint } from 'eslint';

const baselineUrl = new URL('./eslint-baseline.json', import.meta.url);
const baseline = JSON.parse(await readFile(baselineUrl, 'utf8'));
const eslint = new ESLint();
const results = await eslint.lintFiles(['.']);
const errorCount = results.reduce((total, result) => total + result.errorCount, 0);
const warningCount = results.reduce((total, result) => total + result.warningCount, 0);

console.log(`ESLint baseline: ${errorCount} errors / ${warningCount} warnings; allowed: ${baseline.errorCount} / ${baseline.warningCount}`);

if (errorCount > baseline.errorCount || warningCount > baseline.warningCount) {
  console.error('ESLint baseline exceeded. Fix the new findings; do not raise the baseline outside an approved quality-governance change.');
  process.exitCode = 1;
}
