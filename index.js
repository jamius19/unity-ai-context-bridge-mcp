#!/usr/bin/env node

'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const { z } = require('zod');
const { McpServer, ResourceTemplate } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');

const SERVER_INFO = {
  name: 'unity-ai-context-bridge-mcp',
  title: 'Unity AI Context Bridge MCP',
  version: '1.0.0',
};

const RESOURCE_URI_TEMPLATE = 'unity-context://projects/items{?projectPath}';
const DEFAULT_UPSTREAM_TIMEOUT_MS = 5000;

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

function getUnityContextResourceUri(projectPath) {
  return `unity-context://projects/items?projectPath=${encodeURIComponent(projectPath)}`;
}

function decodeProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.length === 0) {
    throw new Error('projectPath is required');
  }

  try {
    return decodeURIComponent(projectPath);
  } catch (err) {
    throw new Error(`projectPath must be URL encoded: ${err.message}`);
  }
}

function getBridgeInfoPath(projectPath) {
  return path.join(projectPath, 'Temp', 'unity-ai-context-bridge', 'bridge.json');
}

async function readBridgeInfo(projectPath) {
  const bridgePath = getBridgeInfoPath(projectPath);
  let bridge;

  try {
    bridge = JSON.parse(await fs.readFile(bridgePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to read Unity context bridge at ${bridgePath}: ${err.message}`);
  }

  if (!bridge || typeof bridge !== 'object' || Array.isArray(bridge)) {
    throw new Error(`Unity context bridge at ${bridgePath} must be a JSON object`);
  }

  if (typeof bridge.url !== 'string' || bridge.url.length === 0) {
    throw new Error(`Unity context bridge at ${bridgePath} must include url`);
  }

  return bridge;
}

function validateUnityContext(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Unity context response must be a JSON object');
  }

  if (!Array.isArray(payload.items)) {
    throw new Error('Unity context response must include an items array');
  }

  return payload;
}

function fetchJson(url, authKey, timeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const headers = { accept: 'application/json' };
    if (authKey) {
      headers.authorization = `Bearer ${authKey}`;
    }

    const req = transport.get(parsed, { headers }, (res) => {
      const chunks = [];
      let size = 0;

      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          reject(new Error('Unity AI Context Bridge Editor Extension endpoint returned a response that is too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Unity AI Context Bridge Editor Extension endpoint returned HTTP ${res.statusCode}: ${body}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Unity AI Context Bridge Editor Extension endpoint returned invalid JSON: ${err.message}`));
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Unity AI Context Bridge Editor Extension endpoint timed out after ${timeoutMs}ms`));
    });

    req.on('error', reject);
  });
}

async function getUnityContext(projectPath) {
  const bridge = await readBridgeInfo(decodeProjectPath(projectPath));
  return validateUnityContext(await fetchJson(bridge.url, bridge.authToken));
}

function createUnityMcpServer() {
  const server = new McpServer(SERVER_INFO);

  server.registerResource(
    'unity-context-items',
    new ResourceTemplate(RESOURCE_URI_TEMPLATE, { list: undefined }),
    {
      title: 'Unity Context Items',
      description: 'Returns information about the Unity GameObjects, assets, and other editor items user selected in the Unity editor that are relevant to the active AI task.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const projectPath = decodeProjectPath(variables.projectPath);
      const unityContext = await getUnityContext(variables.projectPath);
      return {
        contents: [
          {
            uri: getUnityContextResourceUri(projectPath),
            mimeType: 'application/json',
            text: jsonText(unityContext),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get-unity-context-items',
    {
      title: 'Get Unity Context Items',
      description: 'Returns information about the Unity GameObjects, assets, and other editor items user selected in the Unity editor that are relevant to the active AI task.',
      inputSchema: {
        projectPath: z.string().describe('URL-encoded Unity project full path.'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectPath }) => {
      const unityContext = await getUnityContext(projectPath);
      return {
        content: [
          {
            type: 'text',
            text: jsonText(unityContext),
          },
        ],
        structuredContent: unityContext,
      };
    },
  );

  return server;
}

function isAuthorized(req, authToken) {
  if (!authToken) {
    return true;
  }

  const bearer = req.headers.authorization;
  const token = req.headers['x-auth-token'];
  return bearer === `Bearer ${authToken}` || token === authToken;
}

function sendJson(res, statusCode, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body, 'utf8'),
  });
  res.end(body);
}

function authMiddleware(authToken) {
  return (req, res, next) => {
    if (isAuthorized(req, authToken)) {
      next();
      return;
    }

    res.status(401).json({
      error: 'Unauthorized',
      message: 'Send Authorization: Bearer <token> or x-auth-token: <token>.',
    });
  };
}

async function startStdioServer() {
  const server = createUnityMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttpServer() {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || process.env.MCP_PORT || 3333);
  const authToken = process.env.MCP_AUTH_TOKEN || process.env.AUTH_TOKEN || '';
  const app = createMcpExpressApp();

  app.get('/health', (req, res) => {
    res.json({ ok: true, serverInfo: SERVER_INFO });
  });

  app.get('/context', authMiddleware(authToken), async (req, res) => {
    try {
      res.json(await getUnityContext(req.query.projectPath));
    } catch (err) {
      res.status(502).json({
        error: 'Bad Gateway',
        message: err.message,
      });
    }
  });

  app.post('/mcp', authMiddleware(authToken), async (req, res) => {
    const server = createUnityMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close().catch((err) => console.error('Error closing MCP HTTP transport:', err));
        server.close().catch((err) => console.error('Error closing MCP HTTP server:', err));
      });
    } catch (err) {
      console.error('Error handling MCP HTTP request:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', authMiddleware(authToken), (req, res) => {
    sendJson(res, 405, {
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
  });

  app.delete('/mcp', authMiddleware(authToken), (req, res) => {
    sendJson(res, 405, {
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
  });

  await new Promise((resolve, reject) => {
    const listener = app.listen(port, host, () => {
      console.error(`${SERVER_INFO.name} Streamable HTTP server listening on http://${host}:${port}/mcp`);
      if (!authToken) {
        console.error('MCP_AUTH_TOKEN is not set; HTTP auth is disabled.');
      }
      resolve(listener);
    });

    listener.on('error', reject);
  });
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const start = args.has('--http') ? startHttpServer : startStdioServer;

  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
