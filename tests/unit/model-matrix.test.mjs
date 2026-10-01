import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatrixCell, executeModelMatrix, generateModelMatrixHtml } from '../../src/evals/model-matrix.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(__dirname, '..', 'fixtures', 'eval-platform', 'manifest.json');
const dataset = JSON.parse(readFileSync(manifestPath, 'utf-8'));
dataset.root = resolve(__dirname, '..', 'fixtures', 'eval-platform');

test('runMatrixCell records all required assurance and telemetry metrics', async () => {
  const config = {
    name: 'test-multi-agent',
    architecture: 'multi-agent',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet',
    specialist: 'specialist-v2',
    verifier: 'verifier-adversarial',
    judge: 'principal-judge-v1',
    temperature: 0.1,
    verifierReliability: 1.0,
  };

  const res = await runMatrixCell(config, dataset);
  assert.equal(res.config.name, 'test-multi-agent');
  assert.equal(res.config.architecture, 'multi-agent');
  assert.equal(res.config.provider, 'anthropic');
  assert.equal(res.config.model, 'claude-3-5-sonnet');
  assert.equal(res.config.temperature, 0.1);

  const m = res.metrics;
  assert.ok('precision' in m);
  assert.ok('recall' in m);
  assert.ok('f1' in m);
  assert.ok('falsePositiveRate' in m);
  assert.ok('severityAccuracy' in m);
  assert.ok('locationAccuracy' in m);
  assert.ok('verificationAccuracy' in m);
  assert.ok('reproductionRate' in m);
  assert.ok('latencyMs' in m);
  assert.ok('tokenCostUsd' in m);
  assert.ok('totalTokens' in m);
});

test('executeModelMatrix runs multiple architectures and identifies leaderboard', async () => {
  const configs = [
    { name: 'Det-Only', architecture: 'deterministic-only', model: 'none', provider: 'none' },
    { name: 'Single-Agent', architecture: 'single-agent', model: 'mock-model', provider: 'mock' },
    { name: 'Multi-Agent', architecture: 'multi-agent', model: 'mock-model', provider: 'mock', verifierReliability: 0.9 },
  ];

  const matrixReport = await executeModelMatrix(configs, dataset);
  assert.equal(matrixReport.totalExperiments, 3);
  assert.ok(matrixReport.leaderboard.bestOverall);
  assert.ok(matrixReport.leaderboard.bestValue);
  assert.ok(matrixReport.leaderboard.fastest);
  assert.equal(matrixReport.experiments.length, 3);
});

test('generateModelMatrixHtml renders interactive dashboard with table and bar charts', () => {
  const mockReport = {
    schemaVersion: '2.0.0',
    datasetName: 'test-ds',
    datasetVersion: '2.0.0',
    totalExperiments: 2,
    leaderboard: { bestOverall: 'Exp-1', bestValue: 'Exp-2', fastest: 'Exp-1' },
    experiments: [
      {
        config: { name: 'Exp-1', architecture: 'multi-agent', model: 'gpt-4o' },
        metrics: { precision: 0.95, recall: 0.9, f1: 0.92, falsePositiveRate: 0.05, severityAccuracy: 0.9, locationAccuracy: 0.95, verificationAccuracy: 0.98, tokenCostUsd: 0.02, latencyMs: 250 },
      },
      {
        config: { name: 'Exp-2', architecture: 'deterministic-only', model: 'none' },
        metrics: { precision: 1.0, recall: 0.7, f1: 0.82, falsePositiveRate: 0.0, severityAccuracy: 0.85, locationAccuracy: 1.0, verificationAccuracy: 0.9, tokenCostUsd: 0.0, latencyMs: 30 },
      },
    ],
  };

  const html = generateModelMatrixHtml(mockReport);
  assert.ok(html.includes('Arena Model Matrix & Evaluation Report'));
  assert.ok(html.includes('Exp-1'));
  assert.ok(html.includes('Exp-2'));
  assert.ok(html.includes('matrix-table'));
  assert.ok(html.includes('bar-fill'));
});
