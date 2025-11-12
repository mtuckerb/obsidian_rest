"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const moment_1 = __importDefault(require("moment"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 22222;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || path_1.default.join(process.env.HOME || '/tmp', 'vault');
function getMarkdownFiles(dir) {
    if (!fs_1.default.existsSync(dir)) {
        console.log(`❌ Vault path does not exist: ${dir}`);
        return [];
    }
    const files = fs_1.default.readdirSync(dir);
    const mdFiles = [];
    for (const file of files) {
        const filePath = path_1.default.join(dir, file);
        const stat = fs_1.default.statSync(filePath);
        if (stat.isDirectory()) {
            mdFiles.push(...getMarkdownFiles(filePath));
        }
        else if (file.endsWith('.md')) {
            mdFiles.push(filePath);
        }
    }
    return mdFiles;
}
function parseDueDates(content, filePath) {
    const dueDates = [];
    const regex = /# Due Dates([\s\S]*?)(?=\n#|$)/;
    const match = content.match(regex);
    if (match) {
        const tableData = match[1].trim();
        const lines = tableData.split("\n").slice(1);
        for (const line of lines) {
            const columns = line
                .split("|")
                .map((c) => c.trim())
                .filter((c) => c);
            if (columns.length >= 2) {
                let [dueDate, assignment] = columns;
                if (!Date.parse(dueDate) || assignment?.match(/✅/)) {
                    continue;
                }
                assignment = assignment?.match(/[A-Z]{3}-[0-9]{3}/)
                    ? assignment
                    : `#${path_1.default.basename(filePath, '.md')} - ${assignment}`;
                const dueDateMoment = (0, moment_1.default)(dueDate);
                const now = (0, moment_1.default)();
                if (dueDateMoment.isBefore(now.subtract(1, 'month'))) {
                    continue;
                }
                let formattedDate;
                if (dueDateMoment.isAfter(now.subtract(1, 'w'))) {
                    formattedDate = `<span class="due one_week">${dueDateMoment.format("YYYY-MM-DD ddd")}</span>`;
                }
                else if (dueDateMoment.isAfter(now.subtract(2, 'w'))) {
                    formattedDate = `<span class="due two_weeks">${dueDateMoment.format("YYYY-MM-DD ddd")}</span>`;
                }
                else {
                    formattedDate = dueDateMoment.format("YYYY-MM-DD ddd");
                }
                dueDates.push({
                    dueDate,
                    assignment,
                    file: filePath,
                    completed: false,
                    formattedDate
                });
            }
        }
    }
    return dueDates;
}
app.get('/due-dates', (req, res) => {
    try {
        console.log('🔍 Processing due-dates request...');
        const allFiles = getMarkdownFiles(VAULT_PATH);
        let allDueDates = [];
        console.log(`📁 Found ${allFiles.length} markdown files to process`);
        for (const file of allFiles) {
            try {
                const content = fs_1.default.readFileSync(file, 'utf-8');
                const relativePath = path_1.default.relative(VAULT_PATH, file);
                console.log(`📄 Processing: ${relativePath}`);
                const dueDates = parseDueDates(content, file);
                if (dueDates.length > 0) {
                    console.log(`✅ Found ${dueDates.length} due dates in ${relativePath}`);
                    allDueDates.push(...dueDates);
                }
            }
            catch (fileError) {
                console.error(`❌ Error reading file ${file}:`, fileError);
            }
        }
        console.log(`📋 Total due dates found: ${allDueDates.length}`);
        allDueDates.sort((a, b) => (0, moment_1.default)(a.dueDate).valueOf() - (0, moment_1.default)(b.dueDate).valueOf());
        const { startDate, endDate } = req.query;
        if (startDate) {
            const start = (0, moment_1.default)(startDate);
            allDueDates = allDueDates.filter(dd => (0, moment_1.default)(dd.dueDate).isAfter(start.subtract(1, 'day')));
        }
        if (endDate) {
            const end = (0, moment_1.default)(endDate);
            allDueDates = allDueDates.filter(dd => (0, moment_1.default)(dd.dueDate).isBefore(end.add(1, 'day')));
        }
        console.log(`📊 Returning ${allDueDates.length} due dates`);
        res.json({
            success: true,
            count: allDueDates.length,
            dueDates: allDueDates,
            source: 'obsidian-todos-api',
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        console.error('❌ Error fetching due dates:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch due dates',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
app.get('/todos', (req, res) => {
    try {
        const allFiles = getMarkdownFiles(VAULT_PATH);
        let allTodos = [];
        for (const file of allFiles) {
            const content = fs_1.default.readFileSync(file, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const todoMatch = line.match(/^-\s*\[(x|X| )\]\s*(.+)$/);
                if (todoMatch) {
                    const completed = todoMatch[1].toLowerCase() === 'x';
                    const text = todoMatch[2].trim();
                    allTodos.push({
                        id: `${file}:${i}`,
                        text,
                        completed,
                        file: path_1.default.relative(VAULT_PATH, file),
                        line: i + 1
                    });
                }
            }
        }
        res.json({
            success: true,
            count: allTodos.length,
            todos: allTodos
        });
    }
    catch (error) {
        console.error('Error fetching todos:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch todos'
        });
    }
});
app.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'Obsidian Todos API Server is running',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});
app.listen(PORT, () => {
    console.log(`🚀 Obsidian Todos API Server running on port ${PORT}`);
    console.log(`📁 Vault path: ${VAULT_PATH}`);
    console.log(`📋 Endpoints:`);
    console.log(`   GET  /due-dates - List all due dates`);
    console.log(`   GET  /todos     - List all todos`);
    console.log(`   GET  /health    - Health check`);
    console.log('');
    console.log('✅ The list_due_dates endpoint is now available!');
});
exports.default = app;
//# sourceMappingURL=server.js.map