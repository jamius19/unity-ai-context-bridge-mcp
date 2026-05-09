# Unity AI Context Bridge MCP

Node MCP server that feeds AI tools the currently selected Unity GameObjects, assets, and other editor items that are relevant to the active task.

The MCP server runs on stdio or Streamable HTTP. In HTTP mode it defaults to:

```text
http://127.0.0.1:3333/mcp
```

It fetches the live Unity selection context from:

```text
http://127.0.0.1:17777/
```

Override it with `UNITY_CONTEXT_URL` if your Unity bridge listens somewhere else. The upstream response must be a JSON object with an `items` array. The array may be empty when nothing relevant is selected.

## Run over stdio

```powershell
npm run start:stdio
```

Use this transport from MCP clients that launch servers as subprocesses.

## Run over HTTP

```powershell
$env:UNITY_CONTEXT_URL = "http://127.0.0.1:17777/"
$env:MCP_AUTH_TOKEN = "change-me"
$env:PORT = "3333"
npm run start:http
```

HTTP endpoints:

- `GET /health` does not require auth.
- `GET /context` returns the raw currently selected Unity objects/assets context JSON.
- `POST /mcp` is the SDK Streamable HTTP MCP endpoint for AI tools.

Authenticated HTTP requests must include either:

```text
Authorization: Bearer change-me
```

or:

```text
x-auth-token: change-me
```

## MCP surface

Resource:

- `unity-context://current/items`: currently selected Unity GameObjects/assets of interest.

Tool:

- `get_unity_context`: returns the current Unity selection context for AI tools.

Example JSON-RPC request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_unity_context",
    "arguments": {}
  }
}
```

## Test

```powershell
npm test
```

The test uses SDK clients for both Streamable HTTP and stdio.
