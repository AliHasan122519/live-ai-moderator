import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiClient } from './api.js';
import { buildMcpServer } from './server.js';

const api = new ApiClient(process.env.MCP_API_URL ?? 'http://localhost:4000', process.env.MCP_API_TOKEN ?? '');
const server = buildMcpServer(api, { allowedDir: process.env.MCP_ALLOWED_DIR ?? '', enableApproval: process.env.MCP_ENABLE_APPROVAL === 'true' });
await server.connect(new StdioServerTransport());
// stdout محجوز لبروتوكول MCP؛ أي سجلات تذهب إلى stderr
console.error('tiktok-ai-publisher MCP جاهز');
