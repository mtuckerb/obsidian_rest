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
function parseDueDates(content, filePath, includeCompleted = false) {
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
                // Check if assignment is completed (has ✅)
                const isCompleted = assignment?.match(/✅/) !== null;
                // Skip completed items unless includeCompleted is true
                if (isCompleted && !includeCompleted) {
                    continue;
                }
                if (!Date.parse(dueDate)) {
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
                    completed: isCompleted,
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
        console.log(`📊 Query params:`, req.query);
        const allFiles = getMarkdownFiles(VAULT_PATH);
        let allDueDates = [];
        console.log(`📁 Found ${allFiles.length} markdown files to process`);
        // Parse query parameters first
        const includeCompleted = req.query.includeCompleted === 'true' || req.query.includeCompleted === '1';
        const { startDate, endDate } = req.query;
        for (const file of allFiles) {
            try {
                const content = fs_1.default.readFileSync(file, 'utf-8');
                const relativePath = path_1.default.relative(VAULT_PATH, file);
                console.log(`📄 Processing: ${relativePath}`);
                const dueDates = parseDueDates(content, file, includeCompleted);
                if (dueDates.length > 0) {
                    console.log(`✅ Found ${dueDates.length} due dates in ${relativePath}`);
                    allDueDates.push(...dueDates);
                }
            }
            catch (fileError) {
                console.error(`❌ Error reading file ${file}:`, fileError);
            }
        }
        console.log(`📋 Total due dates found before filtering: ${allDueDates.length}`);
        // Sort by due date
        allDueDates.sort((a, b) => (0, moment_1.default)(a.dueDate).valueOf() - (0, moment_1.default)(b.dueDate).valueOf());
        // Apply date filtering with proper logic
        if (startDate) {
            console.log(`📅 Applying startDate filter: ${startDate}`);
            const start = (0, moment_1.default)(startDate).startOf('day');
            allDueDates = allDueDates.filter(dd => {
                const ddMoment = (0, moment_1.default)(dd.dueDate);
                return ddMoment.isSameOrAfter(start, 'day');
            });
        }
        if (endDate) {
            console.log(`📅 Applying endDate filter: ${endDate}`);
            const end = (0, moment_1.default)(endDate).endOf('day');
            allDueDates = allDueDates.filter(dd => {
                const ddMoment = (0, moment_1.default)(dd.dueDate);
                return ddMoment.isSameOrBefore(end, 'day');
            });
        }
        console.log(`📊 Returning ${allDueDates.length} due dates after filtering`);
        res.json({
            success: true,
            count: allDueDates.length,
            dueDates: allDueDates,
            source: 'obsidian-todos-api',
            timestamp: new Date().toISOString(),
            filters: {
                includeCompleted,
                startDate: startDate || null,
                endDate: endDate || null
            }
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
function parseTodos(content, filePath) {
    const todos = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Enhanced regex to capture any character in brackets: - [x], - [!], - [?], etc.
        const todoMatch = line.match(/^-\s*\[(.)\]\s*(.+)$/);
        if (todoMatch) {
            const status = todoMatch[1]; // The character in brackets: x, X, !, ?, etc.
            const completed = status.toLowerCase() === 'x'; // Only 'x' or 'X' means completed
            const text = todoMatch[2].trim();
            todos.push({
                id: `${filePath}:${i}`,
                text,
                completed,
                file: path_1.default.relative(VAULT_PATH, filePath),
                line: i + 1,
                status: status // Store the actual status character
            });
        }
    }
    return todos;
}
app.get('/todos', (req, res) => {
    try {
        console.log('🔍 Processing todos request...');
        console.log(`📊 Query params:`, req.query);
        const allFiles = getMarkdownFiles(VAULT_PATH);
        let allTodos = [];
        for (const file of allFiles) {
            const content = fs_1.default.readFileSync(file, 'utf-8');
            const todos = parseTodos(content, file);
            allTodos.push(...todos);
        }
        console.log(`📋 Total todos found before filtering: ${allTodos.length}`);
        // Apply filtering based on query parameters
        const { completed, status, search, file } = req.query;
        if (completed !== undefined) {
            const isCompleted = completed === 'true' || completed === '1';
            console.log(`📋 Filtering by completed: ${isCompleted}`);
            allTodos = allTodos.filter(todo => todo.completed === isCompleted);
        }
        if (status) {
            console.log(`📋 Filtering by status: ${status}`);
            allTodos = allTodos.filter(todo => todo.status === status);
        }
        if (search) {
            console.log(`🔍 Filtering by search: ${search}`);
            const searchLower = search.toLowerCase();
            allTodos = allTodos.filter(todo => todo.text.toLowerCase().includes(searchLower));
        }
        if (file) {
            console.log(`📄 Filtering by file: ${file}`);
            allTodos = allTodos.filter(todo => todo.file.toLowerCase().includes(file.toLowerCase()));
        }
        console.log(`📊 Returning ${allTodos.length} todos after filtering`);
        res.json({
            success: true,
            count: allTodos.length,
            todos: allTodos,
            source: 'obsidian-todos-api',
            timestamp: new Date().toISOString(),
            filters: {
                completed: completed || null,
                status: status || null,
                search: search || null,
                file: file || null
            }
        });
    }
    catch (error) {
        console.error('❌ Error fetching todos:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch todos',
            message: error instanceof Error ? error.message : 'Unknown error'
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
    console.log('✅ Enhanced filtering now available!');
});
exports.default = app;
//# sourceMappingURL=server.js.map