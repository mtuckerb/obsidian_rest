#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const serverPath = path_1.default.join(__dirname, 'server.js');
console.log('🚀 Starting Obsidian Todos API Server...');
console.log(`📁 Server path: ${serverPath}`);
const server = (0, child_process_1.spawn)('node', [serverPath], {
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
//# sourceMappingURL=cli.js.map