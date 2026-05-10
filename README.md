## Unity AI Context Bridge MCP

Node MCP server that feeds AI tools Unity GameObjects, assets, and other resources that are selected by the user. Think of it like when you drag source code in Cursor, Antigravity, Github Copilot window to add that file to context, but for Unity.

> [!IMPORTANT]  
> The MCP server requires the `Unity AI Context Bridge` Unity package to be installed in the Unity project.


> [!TIP]  
> For the best experience, use Unity Official MCP server along with this.

<br>

## Installation

Install the package globally:

```shell
npm install -g @jamius19/unity-ai-context-bridge-mcp
```
<br>

## MCP Client Installation

Install the NPM package globally before wiring an MCP client to it. This will enable the `uacb-mcp` command in your terminal,

Choose one transport per client entry:

1. Stdio: the MCP client launches this server as a subprocess.  **(Recommended)**
2. Streamable HTTP: you start this server with `uacb-mcp --http`, then the MCP client connects to `http://127.0.0.1:3333/mcp`.

<br>

### GitHub Copilot (VS Code)

Create or update `.vscode/mcp.json` in a project, or run `MCP: Open User Configuration` from the Command Palette for a user-wide setup.

Stdio:

```json
{
  "servers": {
    "unity-ai-context-bridge": {
      "type": "stdio",
      "command": "uacb-mcp",
      "args": ["--stdio"]
    }
  }
}
```

HTTP with auth:

```json
{
  "servers": {
    "unity-ai-context-bridge": {
      "type": "http",
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer change-me"
      }
    }
  }
}
```

HTTP without auth:

```json
{
  "servers": {
    "unity-ai-context-bridge": {
      "type": "http",
      "url": "http://127.0.0.1:3333/mcp"
    }
  }
}
```

After adding the server, run `MCP: List Servers` from the Command Palette and start `unity-ai-context-bridge` if VS Code does not start it automatically. Then open GitHub Copilot Chat in Agent mode and enable the server tools from the tools menu if needed.

<br>

### Rider/Other `mcp.json` clients

Many MCP clients, including Claude Desktop-style JSON configs, accept the same `mcpServers` shape.

Stdio:

```json
{
  "mcpServers": {
    "unity-ai-context-bridge": {
      "command": "uacb-mcp",
      "args": ["--stdio"]
    }
  }
}
```

HTTP:

```json
{
  "mcpServers": {
    "unity-ai-context-bridge": {
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer change-me"
      }
    }
  }
}
```

<br>

### Claude Code

Stdio:

```shell
claude mcp add --transport stdio unity-ai-context-bridge -- uacb-mcp --stdio
```

HTTP with auth:

```shell
claude mcp add --transport http --header "Authorization: Bearer change-me" unity-ai-context-bridge http://127.0.0.1:3333/mcp
```

HTTP without auth:

```shell
claude mcp add --transport http unity-ai-context-bridge http://127.0.0.1:3333/mcp
```

<br>

### Codex

Add one of these entries to `~/.codex/config.toml`.

Stdio:

```toml
[mcp_servers.unity_ai_context_bridge]
command = "uacb-mcp"
args = ["--stdio"]
enabled = true
```

HTTP with auth:

```toml
[mcp_servers.unity_ai_context_bridge]
url = "http://127.0.0.1:3333/mcp"
http_headers = { Authorization = "Bearer change-me" }
enabled = true
```

HTTP without auth:

```toml
[mcp_servers.unity_ai_context_bridge]
url = "http://127.0.0.1:3333/mcp"
enabled = true
```

<br>

### Gemini CLI

Stdio:

```shell
gemini mcp add unity-ai-context-bridge uacb-mcp --stdio
```

HTTP with auth:

```shell
gemini mcp add --transport http unity-ai-context-bridge http://127.0.0.1:3333/mcp --header "Authorization: Bearer change-me"
```

HTTP without auth:

```shell
gemini mcp add --transport http unity-ai-context-bridge http://127.0.0.1:3333/mcp
```

<br>

### Cursor

Create or update `.cursor/mcp.json` in a project, or `~/.cursor/mcp.json` for a user-wide setup.

Stdio:

```json
{
  "mcpServers": {
    "unity-ai-context-bridge": {
      "type": "stdio",
      "command": "uacb-mcp",
      "args": ["--stdio"]
    }
  }
}
```

HTTP with auth:

```json
{
  "mcpServers": {
    "unity-ai-context-bridge": {
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer change-me"
      }
    }
  }
}
```

HTTP without auth:

```json
{
  "mcpServers": {
    "unity-ai-context-bridge": {
      "url": "http://127.0.0.1:3333/mcp"
    }
  }
}
```

<br>

### Run over stdio

```shell
uacb-mcp --stdio
```

Use this transport from MCP clients that launch servers as subprocesses.

<br>

### Run over HTTP

In HTTP mode it defaults to `http://127.0.0.1:3333/mcp` URL.\
You can customize it via the following ways,

PowerShell:

```powershell
$env:MCP_AUTH_TOKEN = "change-me"
$env:PORT = "3333"
uacb-mcp --http
```

Bash:

```bash
MCP_AUTH_TOKEN=change-me PORT=3333 uacb-mcp --http
```

If you do not want HTTP auth during local development, omit `MCP_AUTH_TOKEN`:

```shell
uacb-mcp --http
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

<br>

## MCP surface

Resource template:

- `unity-context://projects/items{?projectPath}`: currently selected Unity GameObjects/assets of interest for a specific project path. Listed concrete resources percent-encode the project path in the query string, so paths with spaces are represented safely, for example `unity-context://projects/items?projectPath=C%3A%5Cexample%5Cunity%5Cunity%5Cproject` for an Unity project in the `C:\example\unity\unity\project` path.

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
      "projectPath": "C%3A%5Cexample%5Cunity%5Cunity%5Cproject"
    }
  }
}
```

If you have Unity Official MCP installed, this will be done automatically, otheriwse you can update your `AGENTS.md` file with the full project path.

<br>

## How does it work?
It automatically discovers the live Unity selection context from the bridge file under the requested Unity project path:

```text
<projectPath>/Temp/unity-ai-context-bridge/bridge.json
```

The bridge file contains the local URL and auth key for that Unity editor instance. The MCP server reads that file for the requested `projectPath`, connects to its `url`, and sends the auth key to Unity AI Context Bridge.

This bridge file is auto generated by the 
