#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';

const serverPath = path.join(__dirname, 'server.js');

console.log('🚀 Starting Obsidian Todos API Server...');
console.log(`📁 Server path: ${serverPath}`);

const server = spawn('node', [serverPath], {
  stdio: 'inherit',
  env: { ...process.env }
});

server.on('close', (code) => {
  console.log(`Server exited with code ${code}`);
  process.exit(code || 0);
});

server.on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
