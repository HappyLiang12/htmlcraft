import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerResources, registerTools } from './tools.js';

export interface CreateMcpServerOptions {
  cwd?: string;
}

export function createMcpServer(
  options: CreateMcpServerOptions = {}
): McpServer {
  const server = new McpServer(
    { name: 'htmlcraft', version: '0.1.0' },
    { instructions: 'Use htmlcraft://contract and htmlcraft://authoring before editing a deck.' }
  );
  registerTools(server, options);
  registerResources(server);
  return server;
}

export async function startStdio(
  options: CreateMcpServerOptions = {}
): Promise<McpServer> {
  const server = createMcpServer(options);
  await server.connect(new StdioServerTransport());
  return server;
}
