/** The embedding app owns model routing, cancellation and usage accounting. */
export interface LlmClient {
  chat(params: { system: string; prompt: string; label?: string }): Promise<string>
}
