#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

import { Server } from "npm:@modelcontextprotocol/sdk@0.7.0/server/index.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@0.7.0/server/stdio.js";
import { 
  CallToolRequestSchema, 
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type GetPromptRequest,
  type ListPromptsRequest,
  type ListToolsRequest,
} from "npm:@modelcontextprotocol/sdk@0.7.0/types.js";

const server = new Server(
  {
    name: "climpt-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      prompts: {},
      tools: {},
    },
  },
);

// プロンプト一覧を返す
server.setRequestHandler(ListPromptsRequestSchema, async (_request: ListPromptsRequest) => {
  return {
    prompts: [
      {
        name: "project",
        description: "プロジェクト要件をGitHub Issuesに分解",
        arguments: [
          {
            name: "input",
            description: "プロジェクトの要件説明（必須）",
            required: true,
          },
          {
            name: "outputFormat",
            description: "出力形式 (markdown | json | yaml)",
            required: false,
          },
        ],
      },
      {
        name: "summary",
        description: "タスクや情報を要約",
        arguments: [
          {
            name: "input",
            description: "要約したい内容（必須）",
            required: true,
          },
          {
            name: "type",
            description: "要約タイプ (task | document | log)",
            required: false,
          },
        ],
      },
      {
        name: "defect",
        description: "エラーログから修正タスクを生成",
        arguments: [
          {
            name: "input",
            description: "エラーログや不具合報告（必須）",
            required: true,
          },
          {
            name: "priority",
            description: "優先度 (low | medium | high | critical)",
            required: false,
          },
        ],
      },
    ],
  };
});

// プロンプトの実行
server.setRequestHandler(GetPromptRequestSchema, async (request: GetPromptRequest) => {
  const { name, arguments: args } = request.params;

  if (name === "project") {
    const input = args?.input || "";
    const outputFormat = args?.outputFormat || "markdown";
    
    return {
      description: "プロジェクトをIssuesに分解",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `以下のプロジェクト要件をGitHub Issuesに分解してください。出力形式: ${outputFormat}\n\n${input}`,
          },
        },
      ],
    };
  }
  
  if (name === "summary") {
    const input = args?.input || "";
    const type = args?.type || "task";
    
    return {
      description: "内容を要約",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `以下の${type}を要約してください：\n\n${input}`,
          },
        },
      ],
    };
  }
  
  if (name === "defect") {
    const input = args?.input || "";
    const priority = args?.priority || "medium";
    
    return {
      description: "エラーログから修正タスクを生成",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `以下のエラーログや不具合報告から修正タスクを生成してください（優先度: ${priority}）：\n\n${input}`,
          },
        },
      ],
    };
  }
  
  throw new Error(`Unknown prompt: ${name}`);
});

// ツール一覧を返す
server.setRequestHandler(ListToolsRequestSchema, async (_request: ListToolsRequest) => {
  return {
    tools: [
      {
        name: "breakdown",
        description: "climpt breakdown コマンドを実行",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              enum: ["project", "summary", "defect"],
              description: "実行するbreakdownコマンド",
            },
            input: {
              type: "string",
              description: "入力内容",
            },
            options: {
              type: "object",
              properties: {
                outputFormat: {
                  type: "string",
                  enum: ["markdown", "json", "yaml"],
                  description: "出力形式",
                },
                outputDir: {
                  type: "string",
                  description: "出力ディレクトリ",
                },
              },
            },
          },
          required: ["command", "input"],
        },
      },
    ],
  };
});

// ツールの実行
server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const { name, arguments: args } = request.params;

  if (name === "breakdown") {
    const { command, input, options } = args as {
      command: string;
      input: string;
      options?: {
        outputFormat?: string;
        outputDir?: string;
      };
    };

    // climptコマンドを実行 (climpt-gitと同じパターン)
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-run",
        "--allow-net",
        "--no-config",
        "jsr:@aidevtool/climpt",
        "--config=" + command,
        "-",
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });

    const process = cmd.spawn();
    const writer = process.stdin.getWriter();
    await writer.write(new TextEncoder().encode(input));
    await writer.close();

    const output = await process.output();
    const outputText = new TextDecoder().decode(output.stdout);
    const errorText = new TextDecoder().decode(output.stderr);

    if (!output.success) {
      return {
        content: [
          {
            type: "text",
            text: `Error executing climpt: ${errorText}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: outputText,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// MCP サーバーを起動
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Server error:", error);
    Deno.exit(1);
  });
}