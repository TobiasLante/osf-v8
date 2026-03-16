import { Request, Response } from 'express';
import { getAllTools, executeTool } from './kg-tools';
import { logger } from '../shared/logger';

/**
 * MCP JSON-RPC Handler.
 * Supports: tools/list, tools/call
 * Format matches v8 Gateway expectations (verified in tool-executor.ts).
 */

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const body = req.body as JsonRpcRequest;
  const id = body.id ?? null;

  try {
    if (!body.method) {
      res.json(errorResponse(id, -32600, 'Invalid request: missing method'));
      return;
    }

    switch (body.method) {
      case 'tools/list': {
        const tools = getAllTools().map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        res.json(successResponse(id, { tools }));
        break;
      }

      case 'tools/call': {
        const { name, arguments: args } = body.params || {};
        if (!name) {
          res.json(errorResponse(id, -32602, 'Missing tool name'));
          return;
        }

        const toolDef = getAllTools().find(t => t.name === name);
        if (!toolDef) {
          res.json(errorResponse(id, -32602, `Unknown tool: ${name}`));
          return;
        }

        try {
          const result = await executeTool(name, args || {});
          res.json(successResponse(id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          }));
        } catch (e: any) {
          logger.warn({ tool: name, err: e.message }, 'Tool execution failed');
          res.json(successResponse(id, {
            content: [{ type: 'text', text: `Error: ${e.message}` }],
            isError: true,
          }));
        }
        break;
      }

      default:
        res.json(errorResponse(id, -32601, `Method not found: ${body.method}`));
    }
  } catch (e: any) {
    logger.error({ err: e.message }, 'MCP handler error');
    res.json(errorResponse(id, -32603, e.message));
  }
}

function successResponse(id: number | string | null, result: any): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
