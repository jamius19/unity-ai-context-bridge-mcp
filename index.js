#!/usr/bin/env node

'use strict';

const http = require('node:http');
const https = require('node:https');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');

const SERVER_INFO = {
  name: 'unity-ai-context-bridge-mcp',
  title: 'Unity AI Context Bridge MCP',
  version: '1.0.0',
};

const RESOURCE_URI = 'unity-context://current/items';
const DEFAULT_UNITY_CONTEXT_URL = 'http://127.0.0.1:17777/';
const DEFAULT_UPSTREAM_TIMEOUT_MS = 5000;

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

function getUnityContextUrl() {
  return process.env.UNITY_CONTEXT_URL || DEFAULT_UNITY_CONTEXT_URL;
}

function normalizeUnityContext(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Unity context response must be a JSON object');
  }

  if (!Array.isArray(payload.items)) {
    throw new Error('Unity context response must include an items array');
  }

  return {
    ...payload,
    source: payload.source || 'unity-ai-context-bridge',
    items: payload.items,
  };
}

function fetchJson(url, timeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const req = transport.get(parsed, { headers: { accept: 'application/json' } }, (res) => {
      const chunks = [];
      let size = 0;

      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          reject(new Error('Unity context response is too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Unity context endpoint returned HTTP ${res.statusCode}: ${body}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Unity context endpoint returned invalid JSON: ${err.message}`));
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Unity context endpoint timed out after ${timeoutMs}ms`));
    });

    req.on('error', reject);
  });
}

async function getUnityContext() {
  return normalizeUnityContext(await fetchJson(getUnityContextUrl()));
}

function createUnityMcpServer() {
  const server = new McpServer(SERVER_INFO);

  server.registerResource(
    'unity-context-items',
    RESOURCE_URI,
    {
      title: 'Unity Context Items',
      description: 'Returns information about the Unity GameObjects, assets, and other editor items user selected in the Unity editor that are relevant to the active AI task.',
      mimeType: 'application/json',
    },
    async () => {
      const unityContext = await getUnityContext();
      return {
        contents: [
          {
            uri: RESOURCE_URI,
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
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const unityContext = await getUnityContext();
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

function startHttpServer() {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || process.env.MCP_PORT || 3333);
  const authToken = process.env.MCP_AUTH_TOKEN || process.env.AUTH_TOKEN || '';
  const app = createMcpExpressApp();

  app.get('/health', (req, res) => {
    res.json({ ok: true, serverInfo: SERVER_INFO, unityContextUrl: getUnityContextUrl() });
  });

  app.get('/context', authMiddleware(authToken), async (req, res) => {
    try {
      res.json(await getUnityContext());
    } catch (err) {
      res.status(502).json({
        error: 'Bad Gateway',
        message: err.message,
        unityContextUrl: getUnityContextUrl(),
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

  app.listen(port, host, (err) => {
    if (err) {
      console.error('Failed to start MCP HTTP server:', err);
      process.exit(1);
    }

    console.error(`${SERVER_INFO.name} Streamable HTTP server listening on http://${host}:${port}/mcp`);
    if (!authToken) {
      console.error('MCP_AUTH_TOKEN is not set; HTTP auth is disabled.');
    }
  });
}

// Test the MCP server by starting it and making some requests with an MCP client, without requiring a real Unity instance or any external dependencies.
async function runSelfTest() {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

  const mockContext = {
    source: 'unity-ai-context-bridge',
    items: [],
  };
  const mockServer = http.createServer((req, res) => {
    sendJson(res, 200, mockContext);
  });
  const originalUnityContextUrl = process.env.UNITY_CONTEXT_URL;

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  process.env.UNITY_CONTEXT_URL = `http://127.0.0.1:${mockServer.address().port}/`;

  const app = createMcpExpressApp();
  const mcpHttpServer = http.createServer(app);

  app.post('/mcp', async (req, res) => {
    const server = createUnityMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
  });

  await new Promise((resolve) => mcpHttpServer.listen(0, '127.0.0.1', resolve));

  try {
    const httpClient = new Client({ name: 'self-test-http-client', version: '1.0.0' });
    const httpTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpHttpServer.address().port}/mcp`));
    await httpClient.connect(httpTransport);

    const tools = await httpClient.listTools();
    const toolCall = await httpClient.callTool({ name: 'get_unity_context', arguments: {} });
    const resources = await httpClient.listResources();
    const resource = await httpClient.readResource({ uri: RESOURCE_URI });
    const resourceText = JSON.parse(resource.contents[0].text);

    await httpClient.close();

    const stdioClient = new Client({ name: 'self-test-stdio-client', version: '1.0.0' });
    const stdioTransport = new StdioClientTransport({
      command: process.execPath,
      args: [__filename, '--stdio'],
      env: {
        UNITY_CONTEXT_URL: process.env.UNITY_CONTEXT_URL,
      },
      stderr: 'pipe',
    });
    await stdioClient.connect(stdioTransport);
    const stdioTools = await stdioClient.listTools();
    await stdioClient.close();

    const checks = [
      tools.tools.some((tool) => tool.name === 'get_unity_context'),
      toolCall.structuredContent && Array.isArray(toolCall.structuredContent.items),
      toolCall.structuredContent.items.length === 0,
      resources.resources.some((entry) => entry.uri === RESOURCE_URI),
      Array.isArray(resourceText.items),
      resourceText.items.length === 0,
      stdioTools.tools.some((tool) => tool.name === 'get_unity_context'),
    ];

    if (!checks.every(Boolean)) {
      throw new Error('Self-test failed');
    }

    console.log('Self-test passed');
  } finally {
    if (originalUnityContextUrl === undefined) {
      delete process.env.UNITY_CONTEXT_URL;
    } else {
      process.env.UNITY_CONTEXT_URL = originalUnityContextUrl;
    }
    await new Promise((resolve) => mcpHttpServer.close(resolve));
    await new Promise((resolve) => mockServer.close(resolve));
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has('--self-test')) {
    await runSelfTest();
    return;
  }

  if (args.has('--http')) {
    startHttpServer();
    return;
  }

  await startStdioServer();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
