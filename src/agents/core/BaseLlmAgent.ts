import { ContinuousContextManager } from "../../context/continuousContextManager.js";
import { ILlmEngine, createLlmEngine } from "../../llm/llmEngine.js";
import { LlmMessage, LlmToolCall, LlmToolDefinition } from "../../llm/types.js";
import { VectorMemoryService } from "../../memory/vectorMemoryService.js";
import { DynamicRecordsService } from "../../records/dynamicRecordsService.js";
import { ToolExecutionResult, ToolRegistry } from "../../tools/toolRegistry.js";

export interface AgentExecutionResult {
  agentId: number;
  agentName: string;
  success: boolean;
  finalResponse: string;
  reasonBearingIntent: string;
  toolCallsExecuted: Array<{
    name: string;
    args: Record<string, any>;
    result: ToolExecutionResult;
  }>;
  sessionId: string;
}

export abstract class BaseLlmAgent {
  public readonly agentId: number;
  public readonly agentName: string;
  public readonly systemInstruction: string;
  protected allowedTools: string[];
  protected llmEngine: ILlmEngine;
  protected contextManager: ContinuousContextManager;
  protected vectorMemory: VectorMemoryService;
  protected dynamicRecords: DynamicRecordsService;
  protected toolRegistry: ToolRegistry;
  protected maxIterations: number;

  constructor(params: {
    agentId: number;
    agentName: string;
    systemInstruction: string;
    allowedTools: string[];
    llmEngine?: ILlmEngine;
    contextManager?: ContinuousContextManager;
    vectorMemory?: VectorMemoryService;
    dynamicRecords?: DynamicRecordsService;
    toolRegistry?: ToolRegistry;
    maxIterations?: number;
  }) {
    this.agentId = params.agentId;
    this.agentName = params.agentName;
    this.systemInstruction = params.systemInstruction;
    this.allowedTools = params.allowedTools;
    this.llmEngine = params.llmEngine || createLlmEngine();
    this.vectorMemory = params.vectorMemory || new VectorMemoryService(this.llmEngine);
    this.contextManager = params.contextManager || new ContinuousContextManager(this.llmEngine, this.vectorMemory);
    this.dynamicRecords = params.dynamicRecords || new DynamicRecordsService();
    this.toolRegistry = params.toolRegistry || new ToolRegistry(this.vectorMemory, this.dynamicRecords);
    this.maxIterations = params.maxIterations || 6;
  }

  /**
   * Executes an autonomous cognitive ReAct deliberation loop.
   */
  public async executeTask(
    sessionId: string,
    taskDescription: string,
    initialMetadata: Record<string, any> = {}
  ): Promise<AgentExecutionResult> {
    // 1. Record task initiation in continuous shared blackboard
    await this.contextManager.recordEvent({
      sessionId,
      agentId: this.agentId,
      agentName: this.agentName,
      eventType: "TASK_INITIATED",
      role: "user",
      content: taskDescription,
      metadata: initialMetadata,
    });

    // 2. Assemble multi-tier context (Hot blackboard + Compacted anchors + Vector retrieval)
    const assembledContext = await this.contextManager.assembleAgentContext(
      sessionId,
      this.agentId,
      this.agentName,
      this.systemInstruction,
      taskDescription
    );

    const messages: LlmMessage[] = [...assembledContext.messages];
    const toolDefs: LlmToolDefinition[] = this.toolRegistry.getToolDefinitions(this.allowedTools);

    const executedTools: Array<{
      name: string;
      args: Record<string, any>;
      result: ToolExecutionResult;
    }> = [];

    let iteration = 0;
    let finalResponse = "";
    let reasonBearingIntent = "";

    while (iteration < this.maxIterations) {
      iteration++;

      // Dispatch to Model-Agnostic LLM Engine
      const response = await this.llmEngine.chatCompletion(messages, toolDefs);

      if (response.content) {
        reasonBearingIntent += (reasonBearingIntent ? "\n" : "") + response.content;
      }

      // Check for tool calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        // Record assistant's reasoning and tool dispatch in messages and continuous context
        messages.push({
          role: "assistant",
          content: response.content || "Calling tools for task execution.",
          tool_calls: response.tool_calls,
        });

        await this.contextManager.recordEvent({
          sessionId,
          agentId: this.agentId,
          agentName: this.agentName,
          eventType: "TOOL_CALLED",
          role: "assistant",
          content: response.content || `Invoking ${response.tool_calls.map((t) => t.function.name).join(", ")}`,
          toolCalls: response.tool_calls,
        });

        // Execute each tool call
        for (const toolCall of response.tool_calls) {
          const toolName = toolCall.function.name;
          let toolArgs: Record<string, any> = {};
          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            toolArgs = {};
          }

          const toolResult = await this.toolRegistry.executeTool(toolName, toolArgs);
          executedTools.push({ name: toolName, args: toolArgs, result: toolResult });

          // Publish tool result to blackboard
          await this.contextManager.recordEvent({
            sessionId,
            agentId: this.agentId,
            agentName: this.agentName,
            eventType: "TOOL_RESULT",
            role: "tool",
            content: JSON.stringify(toolResult),
            toolCallId: toolCall.id,
            metadata: { toolName, success: toolResult.success },
          });

          // Append tool result into LLM conversation history
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify(toolResult),
          });
        }

        // Loop continues so LLM can synthesize after seeing tool outputs
      } else {
        // Stop iteration - LLM reached final decision
        finalResponse = response.content || "Task completed successfully.";
        await this.contextManager.recordEvent({
          sessionId,
          agentId: this.agentId,
          agentName: this.agentName,
          eventType: "AGENT_REASONING",
          role: "assistant",
          content: finalResponse,
          metadata: { iteration, totalToolsExecuted: executedTools.length },
        });
        break;
      }
    }

    if (!finalResponse && iteration >= this.maxIterations) {
      finalResponse = "Reached maximum deliberation iterations. Task executed within safety bounds.";
    }

    return {
      agentId: this.agentId,
      agentName: this.agentName,
      success: executedTools.every((t) => t.result.success),
      finalResponse,
      reasonBearingIntent,
      toolCallsExecuted: executedTools,
      sessionId,
    };
  }
}
