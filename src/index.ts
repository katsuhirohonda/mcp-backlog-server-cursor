
/**
 * シンプルなMCPサーバー
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

// シンプルなツールを定義
function listTools() {
  return {
    tools: [
      {
        name: "list_recent_projects",
        description: "最近見たプロジェクトを取得する",
        inputSchema: {
          type: "object",
          properties: {
            count: {
              type: "number",
              description: "取得するプロジェクトの数 (1-100, デフォルトは20)"
            },
            order: {
              type: "string",
              description: "ソート順 (asc, desc, default desc)",
              enum: ["asc", "desc"]
            }
          },
          required: []
        }
      },
    ]
  };
}

// リソースを定義
function listResources() {
  return {
    resources: [
      {
        uri: "simple://greeting",
        mimeType: "text/plain",
        name: "Greeting",
        description: "簡単な挨拶メッセージ"
      }
    ]
  };
}

// リソースの内容を取得
async function readResource(uri: string) {
  if (uri === "simple://greeting") {
    // 環境変数 SAMPLE_ENV を取得
    const sampleEnv = process.env.SAMPLE_ENV;
    
    // SAMPLE_ENV がない場合はエラーを投げる
    if (!sampleEnv) {
      throw new Error("環境変数 SAMPLE_ENV が設定されていません");
    }
    
    return {
      contents: [{
        uri,
        mimeType: "text/plain",
        text: `こんにちは！シンプルなMCPサーバーへようこそ。\n環境変数 SAMPLE_ENV: ${sampleEnv}`
      }]
    };
  }
  
  throw new Error(`不明なリソース: ${uri}`);
}

function formatToolResponse(title: string, data: any): any {
  return {
    content: [
      {
        type: "text",
        text: `# ${title}\n\n${JSON.stringify(data, null, 2)}`
      }
    ]
  };
}

// ツールを実行
async function executeTools(toolName: string, args: any) {
  switch (toolName) {
    case "list_recent_projects": {
      const count = args?.count && Number(args.count) > 0 && Number(args.count) <= 100 
        ? Number(args.count) 
        : 20;
        
      const order = args?.order === 'asc' ? 'asc' : 'desc';

      const apiKey = process.env.BACKLOG_API_KEY;
      const spaceUrl = process.env.BACKLOG_SPACE_URL;
      
      if (!apiKey || !spaceUrl) {
        throw new Error("BACKLOG_API_KEY と BACKLOG_SPACE_URL の環境変数が必要です");
      }

      let client = new BacklogClient({
        apiKey,
        spaceUrl
      });
      
      const projects = await client.getRecentlyViewedProjects({ 
        count, 
        order 
      });
      
      return formatToolResponse("Recently Viewed Projects", projects);
    }
    
    default:
      throw new Error("unknown tool");
  }
}

// MCPサーバーを作成
const server = new Server(
  {
    name: "mcp-backlog-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// リソース一覧のハンドラー
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return listResources();
});

// リソース内容取得のハンドラー
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  return await readResource(request.params.uri);
});

// ツール一覧のハンドラー
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return listTools();
});

// ツール実行のハンドラー
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return await executeTools(
    request.params.name, 
    request.params.arguments
  );
});

async function main() {
  try {
    // 起動時に環境変数 SAMPLE_ENV の存在を確認
    if (!process.env.BACKLOG_API_KEY || !process.env.BACKLOG_SPACE_URL) {
      throw new Error("BACKLOG_API_KEY と BACKLOG_SPACE_URL の環境変数が必要です。サーバーを起動できません。");
    }
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.error("サーバー初期化エラー:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("サーバーエラー:", error);
  process.exit(1);
});

/**
 * Backlog API client for making API calls
 */
export class BacklogClient {
  private config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = config;
  }

  /**
   * Get the full API URL with API key parameter
   */
  private getUrl(path: string, queryParams: Record<string, string> = {}): string {
    const url = new URL(`${this.config.spaceUrl}/api/v2${path}`);
    
    // Add API key
    url.searchParams.append('apiKey', this.config.apiKey);
    
    // Add any additional query parameters
    Object.entries(queryParams).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
    
    return url.toString();
  }

  /**
   * Make an API request to Backlog
   */
  private async request<T>(path: string, options: RequestInit = {}, queryParams: Record<string, string> = {}): Promise<T> {
    const url = this.getUrl(path, queryParams);
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      const data = await response.json();
      
      if (!response.ok) {
        const error = data as BacklogError;
        throw new Error(`Backlog API Error: ${error.errors?.[0]?.message || 'Unknown error'} (Code: ${error.errors?.[0]?.code})`);
      }
      
      return data as T;
    } catch (error) {
      console.error(`Error in Backlog API request to ${path}:`, error);
      throw error;
    }
  }

  /**
   * Get recently viewed projects for the current user
   */
  async getRecentlyViewedProjects(params: { order?: 'asc' | 'desc', offset?: number, count?: number } = {}): Promise<RecentlyViewedProject[]> {
    const queryParams: Record<string, string> = {};
    
    if (params.order) queryParams.order = params.order;
    if (params.offset !== undefined) queryParams.offset = params.offset.toString();
    if (params.count !== undefined) queryParams.count = params.count.toString();
    
    return this.request<RecentlyViewedProject[]>('/users/myself/recentlyViewedProjects', {}, queryParams);
  }

  /**
   * Get information about a specific project
   */
  async getProject(projectId: string): Promise<BacklogProject> {
    return this.request<BacklogProject>(`/projects/${projectId}`);
  }

  /**
   * Get information about the current user
   */
  async getMyself() {
    return this.request('/users/myself');
  }

  /**
   * Get space information
   */
  async getSpace() {
    return this.request('/space');
  }
}

/**
 * Types for the Backlog MCP server
 */

// Auth configuration
export interface AuthConfig {
  apiKey: string;
  spaceUrl: string;
}

// Backlog Project type
export interface BacklogProject {
  id: number;
  projectKey: string;
  name: string;
  chartEnabled: boolean;
  useResolvedForChart: boolean;
  subtaskingEnabled: boolean;
  projectLeaderCanEditProjectLeader: boolean;
  useWiki: boolean;
  useFileSharing: boolean;
  useWikiTreeView: boolean;
  useSubversion: boolean;
  useGit: boolean;
  useOriginalImageSizeAtWiki: boolean;
  textFormattingRule: string;
  archived: boolean;
  displayOrder: number;
  useDevAttributes: boolean;
}

// Recently viewed project response
export interface RecentlyViewedProject {
  project: BacklogProject;
  updated: string;
}

// Backlog Error response
export interface BacklogError {
  errors: Array<{
    message: string;
    code: number;
    moreInfo: string;
  }>;
}

// Backlog user information
export interface BacklogUser {
  id: number;
  userId: string;
  name: string;
  roleType: number;
  lang: string;
  mailAddress: string;
  nulabAccount: {
    nulabId: string;
    name: string;
    uniqueId: string;
  };
}

// Backlog space information
export interface BacklogSpace {
  spaceKey: string;
  name: string;
  ownerId: number;
  lang: string;
  timezone: string;
  reportSendTime: string;
  textFormattingRule: string;
  created: string;
  updated: string;
}
