export interface McpCallResult {
  content: { type: string; text?: string; [key: string]: unknown }[];
  isError?: boolean;
  structuredContent?: unknown;
}
