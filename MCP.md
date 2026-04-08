# Mova — MCP Server

O Mova expõe suas 10 tools via protocolo MCP (Model Context Protocol), permitindo que qualquer cliente compatível utilize as ferramentas de movimentação de pessoal diretamente.

## URL do servidor

```
https://gente-mova.vercel.app/mcp
```

_(localmente: `http://localhost:3000/mcp`)_

## Tools disponíveis

| Tool | Descrição |
|---|---|
| `get_employees` | Busca colaboradores por CC, cargo, UO, faixa salarial ou nome |
| `get_salary_table` | Retorna faixas salariais por cargo |
| `get_movement_policy` | Retorna política salarial por tipo de movimentação |
| `check_position` | Verifica posição 1:1 aberta no CC |
| `create_position` | Cria nova posição no quadro de vagas |
| `submit_movement` | Abre processo individual de movimentação |
| `list_pending_approvals` | Lista processos pendentes de aprovação |
| `approve_movement` | Aprova processo individual |
| `reject_movement` | Devolve processo com motivo |
| `open_vacancy` | Abre vaga de substituição |

---

## Como conectar

### Claude Desktop

Adicione em `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mova": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://gente-mova.vercel.app/mcp"
      ]
    }
  }
}
```

### Claude Code (terminal)

```bash
claude mcp add --transport http mova https://gente-mova.vercel.app/mcp
```

### Ligia Pro / integração customizada

Use o SDK MCP na linguagem de sua preferência apontando para:
```
POST https://gente-mova.vercel.app/mcp
Content-Type: application/json
```

Protocolo: [MCP Spec](https://modelcontextprotocol.io/specification)

---

## Dados

Todos os dados são mockados (`mock_data.json`). Para produção, substituir cada `get_*` em `src/tools.js` pela chamada real à API LG correspondente, mantendo o mesmo contrato de input/output.
