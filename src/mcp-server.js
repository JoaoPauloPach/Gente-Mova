import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { executeTool, getToolDefinitions } from "./tools.js";

function buildMcpServer() {
  const server = new Server(
    { name: "mova", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // Lista as 10 tools do Mova
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const definitions = getToolDefinitions();
    return {
      tools: definitions.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.input_schema,
      })),
    };
  });

  // Executa uma tool pelo nome
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    console.log(`[MCP] Tool chamada: ${name}`, args);
    try {
      const result = await executeTool(name, args || {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      console.error(`[MCP] Erro na tool ${name}:`, err.message);
      return {
        content: [{ type: "text", text: `Erro: ${err.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// Handler usado pelo server.js para montar a rota /mcp
export async function handleMcpRequest(req, res) {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — sem sessão persistente
  });

  res.on("close", () => server.close());

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[MCP] Erro no handler:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
}
