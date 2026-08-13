import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverProjects, derive, CONFIDENCE } from '../src/core.js';

function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidash-')); fs.mkdirSync(path.join(root, 'alpha', '.git'), { recursive: true }); fs.writeFileSync(path.join(root, 'alpha', 'app.js'), 'export const answer = 42;\n'); return root; }
test('discovers a canonical Git project', () => { const root = fixture(); const projects = discoverProjects(root); assert.equal(projects.length, 1); assert.equal(projects[0].name, 'alpha'); assert.equal(projects[0].confidence, CONFIDENCE.confirmed); });
test('attributes a session only when its cwd falls below a project', () => { const root = fixture(); const project = discoverProjects(root)[0]; const result = derive({ projects: [project], capabilities: [], errors: [], sources: {}, sessions: [{ id:'Claude:1', agent:'Claude', projectId:project.id, timestamp:'2026-08-01T00:00:00Z', usage:{input:10,output:5,cached:0,reasoning:0}, tools:1,compactions:0 }, { id:'Codex:2',agent:'Codex',projectId:null,usage:{input:20,output:0,cached:0,reasoning:0},tools:0,compactions:0 } ] }); assert.equal(result.projects[0].sessionCount, 1); assert.equal(result.summary.observableTokens, 35); });
test('keeps absent usage as zero instead of fabricating it', () => { const result = derive({ projects: [], capabilities: [], errors: [], sources: {}, sessions: [{ id:'Cursor:1',agent:'Cursor',usage:{input:0,output:0,cached:0,reasoning:0},tools:0,compactions:0 }] }); assert.equal(result.summary.observableTokens, 0); assert.equal(result.summary.sessions, 1); });
