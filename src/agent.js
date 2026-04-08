import { GoogleGenerativeAI } from "@google/generative-ai";
import { executeTool, getToolDefinitions } from "./tools.js";

// apiKey é passado por chamada — permite uso sem variável de ambiente

const SYSTEM_PROMPT = `Você é o Mova, agente conversacional de movimentação de pessoal da LG lugar de gente.

Você ajuda gestores e BPs de RH a realizar movimentações de colaboradores — promoções, méritos, transferências — de forma rápida, via conversa natural, sem precisar navegar em múltiplas telas.

## Suas capacidades
- Buscar colaboradores por cargo, CC, UO, faixa salarial ou nome
- Verificar e criar posições 1:1
- Calcular impacto no custo do departamento
- Validar política salarial antes de submeter
- Submeter movimentações individuais (um processo por colaborador)
- Listar e aprovar movimentações pendentes em massa

## Tipos de movimentação
Ao conversar com o usuário, use sempre os nomes em português abaixo. Os códigos em inglês são apenas para uso interno nas tools.
- Mérito (MERIT): aumento por desempenho, máx 8%
- Promoção simples (PROMOTION_SIMPLE): 1 nível, máx 20%
- Promoção dupla (PROMOTION_DOUBLE): 2 níveis, máx 35%
- Promoção tripla (PROMOTION_TRIPLE): 3 níveis, máx 50%
- Transferência lateral (LATERAL_TRANSFER): sem ajuste salarial
- Transferência com aumento (TRANSFER_WITH_RAISE): máx 15%
- Transferência temporária (TEMP_TRANSFER): com eventos de folha
- Substituição (BACKFILL): reposição de colaborador
- Aumento de quadro (HEADCOUNT_INCREASE)

## Como agir — SIGA RIGOROSAMENTE ESSA ORDEM

### Passo 1 — Entender a intenção
Interprete a instrução em linguagem natural e use get_employees para buscar os colaboradores envolvidos.

### Passo 2 — Coletar informações obrigatórias
ANTES de qualquer submit_movement, você DEVE ter confirmado com o usuário:
- Tipo de movimentação (MERIT, PROMOTION_SIMPLE, etc.)
- Novo salário proposto ou percentual de aumento
- Data de efetivação
- Justificativa

Se qualquer uma dessas informações estiver faltando, PERGUNTE ao usuário. Nunca invente ou assuma valores.

### Passo 3 — Mostrar resumo e pedir confirmação EXPLÍCITA
Antes de chamar submit_movement, exiba um resumo com:
- Nome do colaborador
- Cargo atual → cargo destino (se promoção)
- Salário atual → salário proposto
- Percentual de aumento
- Alertas de política salarial (se houver)
- Impacto mensal e anual no custo do CC

Termine sempre com a pergunta: "Confirma a submissão? (sim/não)"

Só chame submit_movement depois que o usuário responder "sim" ou equivalente.

### Passo 4 — Submeter e informar resultado
Após confirmação, chame submit_movement uma vez por colaborador.
Mostre o process_id gerado e o próximo aprovador.

## PROIBIDO
- Chamar submit_movement sem confirmação explícita do usuário
- Assumir salário proposto sem o usuário informar
- Assumir data de efetivação sem o usuário informar

## Cálculo de impacto
- delta_mensal = soma(salário_proposto) - soma(salário_atual) dos afetados
- delta_anual = delta_mensal × 12
- Afastados há mais de 15 dias: excluir do impacto consolidado

## Tom
Direto, claro e profissional. Use bullets para resumos.
Responda sempre em português brasileiro.`;

function buildGeminiTools() {
  const definitions = getToolDefinitions();
  return [
    {
      functionDeclarations: definitions.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      })),
    },
  ];
}

const MAX_HISTORY_TURNS = 20;

function trimHistory(history) {
  if (history.length <= MAX_HISTORY_TURNS) return history;
  let trimmed = history.slice(history.length - MAX_HISTORY_TURNS);
  // Garante que o histórico sempre começa com um turno de usuário com texto
  // (nunca no meio de um par function_call / function_response)
  while (trimmed.length > 0) {
    const first = trimmed[0];
    if (first.role === "user" && first.parts?.[0]?.text) break;
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

async function generateWithRetry(model, contents, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await model.generateContent({ contents });
    } catch (err) {
      const is503 = err.message?.includes("503") || err.message?.includes("high demand");
      if (is503 && attempt < maxRetries) {
        const delay = attempt * 5000; // 5s, 10s, 15s
        console.log(`[Mova] Modelo sobrecarregado, aguardando ${delay/1000}s... (tentativa ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

export async function chat(conversationHistory, userMessage, apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey || process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_PROMPT,
    tools: buildGeminiTools(),
  });

  // Monta o array de contents com histórico trimado + nova mensagem do usuário
  const contents = [
    ...trimHistory(conversationHistory),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  let response = await generateWithRetry(model, contents);
  let result = response.response;

  // Agentic loop — executa tools até o modelo parar de retornar function calls
  while (true) {
    const functionCalls = result.functionCalls();
    if (!functionCalls || functionCalls.length === 0) break;

    // Adiciona resposta do modelo (com as tool calls) ao histórico
    contents.push({
      role: "model",
      parts: result.candidates[0].content.parts,
    });

    // Executa cada tool e coleta resultados
    const toolResultParts = [];
    for (const fc of functionCalls) {
      console.log(`[Mova] Executando tool: ${fc.name}`, fc.args);
      const toolResult = await executeTool(fc.name, fc.args);
      console.log(`[Mova] Resultado:`, toolResult);

      toolResultParts.push({
        functionResponse: {
          name: fc.name,
          response: toolResult,
        },
      });
    }

    // Adiciona resultados das tools como mensagem do usuário
    contents.push({ role: "user", parts: toolResultParts });

    response = await generateWithRetry(model, contents);
    result = response.response;
  }

  const reply = result.text();

  // Histórico atualizado inclui tudo + resposta final do modelo
  const updatedHistory = [
    ...contents,
    { role: "model", parts: [{ text: reply }] },
  ];

  return { reply, updatedHistory };
}
