# Unity AI Context Bridge MCP

Node MCP server that feeds AI tools the currently selected Unity GameObjects, assets, and other editor items that are relevant to the active task.

The MCP server runs on stdio or Streamable HTTP. In HTTP mode it defaults to:

```text
http://127.0.0.1:3333/mcp
```

It discovers the live Unity selection context from the bridge file under the requested Unity project path:

```text
<projectPath>/Temp/unity-ai-context-bridge/bridge.json
```

The bridge file contains the local URL and auth key for that Unity editor instance. The MCP server reads that file for the requested `projectPath`, connects to its `url`, and sends the auth key to Unity as `Authorization: Bearar <authKey>`.

The upstream response must be a JSON object with an `items` array. The array may be empty when nothing relevant is selected.

## Run over stdio

```powershell
npm run start:stdio
```

Use this transport from MCP clients that launch servers as subprocesses.

## Run over HTTP

```powershell
$env:MCP_AUTH_TOKEN = "change-me"
$env:PORT = "3333"
npm run start:http
```

HTTP endpoints:

- `GET /health` does not require auth.
- `GET /context` returns the raw currently selected Unity objects/assets context JSON. It requires a `projectPath` query parameter to select a specific Unity project bridge.
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

Resource template:

- `unity-context://projects/items{?projectPath}`: currently selected Unity GameObjects/assets of interest for a specific project path. Listed concrete resources percent-encode the project path in the query string, so paths with spaces are represented safely, for example `unity-context://projects/items?projectPath=K%3A%5Cgamedev%5Cspace%20project`.

Tool:

- `get-unity-context-items`: returns the current Unity selection context for AI tools. It requires a URL-encoded `projectPath`; the server reads that project's bridge file and uses its URL.

Example JSON-RPC request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get-unity-context-items",
    "arguments": {
      "projectPath": "K%3A%5Cgamedev%5Cartemis%5Cunity%5Cartemis"
    }
  }
}
```
