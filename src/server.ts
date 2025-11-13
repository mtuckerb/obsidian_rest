import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import moment from 'moment';

const app = express();
const PORT = process.env.PORT || 22222;

app.use(cors());
app.use(express.json());

const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || path.join(process.env.HOME || '/tmp', 'vault');

function getMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    console.log(`❌ Vault path does not exist: ${dir}`);
    return [];
  }
  
  const files = fs.readdirSync(dir);
  const mdFiles: string[] = [];
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      mdFiles.push(...getMarkdownFiles(filePath));
    } else if (file.endsWith('.md')) {
      mdFiles.push(filePath);
    }
  }
  
  return mdFiles;
}

interface DueDate {
  dueDate: string;
  assignment: string;
  file: string;
  completed: boolean;
  formattedDate: string;
}

function parseDueDates(content: string, filePath: string, includeCompleted = false): DueDate[] {
  const dueDates: DueDate[] = [];
  
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
          : `#${path.basename(filePath, '.md')} - ${assignment}`;
        
        const dueDateMoment = moment(dueDate);
        const now = moment();
        
        if (dueDateMoment.isBefore(now.subtract(1, 'month'))) {
          continue;
        }
        
        let formattedDate: string;
        if (dueDateMoment.isAfter(now.subtract(1, 'w'))) {
          formattedDate = `<span class="due one_week">${dueDateMoment.format("YYYY-MM-DD ddd")}</span>`;
        } else if (dueDateMoment.isAfter(now.subtract(2, 'w'))) {
          formattedDate = `<span class="due two_weeks">${dueDateMoment.format("YYYY-MM-DD ddd")}</span>`;
        } else {
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
  
// Enhanced query parameter parsing
interface QueryFilter {
  tags?: string[];           // #education, #work, etc.
  paths?: string[];          // 2025, courses/math, etc.
  text?: string;             // Search in assignment text
  completed?: boolean;       // Filter by completion status
  includeCompleted?: boolean; // Include completed items
  startDate?: string;        // Date range start
  endDate?: string;          // Date range end
}

function parseQueryFilter(query: any): QueryFilter {
  const filter: QueryFilter = {};
  
  // Parse tags (#education -> tag: education)
  if (query.tag) {
    filter.tags = Array.isArray(query.tag) ? query.tag : [query.tag];
  }
  
  // Parse path filters (2025 -> path starts with or contains 2025)
  if (query.path) {
    filter.paths = Array.isArray(query.path) ? query.path : [query.path];
  }
  
  // Parse text search
  if (query.text) {
    filter.text = query.text as string;
  }
  
  // Parse completion status
  if (query.completed !== undefined) {
    filter.completed = query.completed === 'true' || query.completed === '1';
  }
  
  // Parse include completed
  if (query.includeCompleted !== undefined) {
    filter.includeCompleted = query.includeCompleted === 'true' || query.includeCompleted === '1';
  }
  
  // Parse dates
  if (query.startDate) {
    filter.startDate = query.startDate as string;
  }
  if (query.endDate) {
    filter.endDate = query.endDate as string;
  }
  
  return filter;
}

function matchesTag(content: string, filePath: string, tags: string[]): boolean {
  if (!tags || tags.length === 0) return true;
  
  // Check content for tags
  const contentLower = content.toLowerCase();
  const fileNameLower = path.basename(filePath, '.md').toLowerCase();
  
  return tags.some(tag => {
    const tagLower = tag.toLowerCase();
    // Check for #tag in content
    if (contentLower.includes(`#${tagLower}`)) return true;
    // Check for tag: prefix in content (Obsidian style)
    if (contentLower.includes(`tag: ${tagLower}`)) return true;
    // Check if filename contains tag
    if (fileNameLower.includes(tagLower)) return true;
    return false;
  });
}

function matchesPath(filePath: string, pathFilters: string[]): boolean {
  if (!pathFilters || pathFilters.length === 0) return true;
  
  const relativePath = path.relative(VAULT_PATH, filePath).toLowerCase();
  const fileName = path.basename(filePath, '.md').toLowerCase();
  
  return pathFilters.some(filter => {
    const filterLower = filter.toLowerCase();
    // Check if path starts with filter (2025/...)
    if (relativePath.startsWith(filterLower)) return true;
    // Check if path contains filter anywhere
    if (relativePath.includes(filterLower)) return true;
    // Check if filename starts with filter (2025-notes.md)
    if (fileName.startsWith(filterLower)) return true;
    return false;
  });
}

function matchesText(text: string, searchText: string): boolean {
  if (!searchText) return true;
  return text.toLowerCase().includes(searchText.toLowerCase());
}
  try {
    console.log('🔍 Processing due-dates request...');
    console.log(`📊 Query params:`, req.query);
    
    const allFiles = getMarkdownFiles(VAULT_PATH);
    let allDueDates: DueDate[] = [];
    
    console.log(`📁 Found ${allFiles.length} markdown files to process`);
    
    // Parse query parameters first
    const includeCompleted = req.query.includeCompleted === 'true' || req.query.includeCompleted === '1';
    const { startDate, endDate } = req.query;
    
    for (const file of allFiles) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const relativePath = path.relative(VAULT_PATH, file);
        console.log(`📄 Processing: ${relativePath}`);
        
        const dueDates = parseDueDates(content, file, includeCompleted);
        if (dueDates.length > 0) {
          console.log(`✅ Found ${dueDates.length} due dates in ${relativePath}`);
          allDueDates.push(...dueDates);
        }
      } catch (fileError) {
        console.error(`❌ Error reading file ${file}:`, fileError);
      }
    }
    
    console.log(`📋 Total due dates found before filtering: ${allDueDates.length}`);
    
    // Sort by due date
    allDueDates.sort((a, b) => moment(a.dueDate).valueOf() - moment(b.dueDate).valueOf());
    
    // Apply date filtering with proper logic
    if (startDate) {
      console.log(`📅 Applying startDate filter: ${startDate}`);
      const start = moment(startDate as string).startOf('day');
      allDueDates = allDueDates.filter(dd => {
        const ddMoment = moment(dd.dueDate);
        return ddMoment.isSameOrAfter(start, 'day');
      });
    }
    
    if (endDate) {
      console.log(`📅 Applying endDate filter: ${endDate}`);
      const end = moment(endDate as string).endOf('day');
      allDueDates = allDueDates.filter(dd => {
        const ddMoment = moment(dd.dueDate);
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
  } catch (error) {
    console.error('❌ Error fetching due dates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch due dates',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  file: string;
  line: number;
  status?: string;  // Added status field for custom todo markers
}

function parseTodos(content: string, filePath: string): Todo[] {
  const todos: Todo[] = [];
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Enhanced regex to capture any character in brackets: - [x], - [!], - [?], etc.
    const todoMatch = line.match(/^-\s*\[(.)\]\s*(.+)$/);
    
    if (todoMatch) {
      const status = todoMatch[1];  // The character in brackets: x, X, !, ?, etc.
      const completed = status.toLowerCase() === 'x';  // Only 'x' or 'X' means completed
      const text = todoMatch[2].trim();
      
      todos.push({
        id: `${filePath}:${i}`,
        text,
        completed,
        file: path.relative(VAULT_PATH, filePath),
        line: i + 1,
        status: status  // Store the actual status character
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
    let allTodos: Todo[] = [];
    
    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf-8');
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
      const searchLower = (search as string).toLowerCase();
      allTodos = allTodos.filter(todo => 
        todo.text.toLowerCase().includes(searchLower)
      );
    }
    
    if (file) {
      console.log(`📄 Filtering by file: ${file}`);
      allTodos = allTodos.filter(todo => 
        todo.file.toLowerCase().includes((file as string).toLowerCase())
      );
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
  } catch (error) {
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

export default app;
