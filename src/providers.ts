import path from 'node:path';

import { ApiProvider, ProviderResponse } from './types.js';
import { fetchWithTimeout } from './util.js';
import logger from './logger.js';

const DEFAULT_OPENAI_HOST = 'api.openai.com';

const REQUEST_TIMEOUT_MS = process.env.REQUEST_TIMEOUT_MS
  ? parseInt(process.env.REQUEST_TIMEOUT_MS, 10)
  : 10_000;

export class OpenAiGenericProvider implements ApiProvider {
  modelName: string;
  apiKey: string;
  apiHost: string;

  constructor(modelName: string, apiKey?: string) {
    this.modelName = modelName;

    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        'OpenAI API key is not set. Set OPENAI_API_KEY environment variable or pass it as an argument to the constructor.',
      );
    }
    this.apiKey = key;

    this.apiHost = process.env.OPENAI_API_HOST || DEFAULT_OPENAI_HOST;
  }

  id(): string {
    return `openai:${this.modelName}`;
  }

  toString(): string {
    return `[OpenAI Provider ${this.modelName}]`;
  }

  // @ts-ignore: Prompt is not used in this implementation
  async callApi(prompt: string): Promise<ProviderResponse> {
    throw new Error('Not implemented');
  }
}

export class OpenAiCompletionProvider extends OpenAiGenericProvider {
  static OPENAI_COMPLETION_MODELS = [
    'text-davinci-003',
    'text-davinci-002',
    'text-curie-001',
    'text-babbage-001',
    'text-ada-001',
  ];

  constructor(modelName: string, apiKey?: string) {
    if (!OpenAiCompletionProvider.OPENAI_COMPLETION_MODELS.includes(modelName)) {
      logger.warn(`Using unknown OpenAI completion model: ${modelName}`);
    }
    super(modelName, apiKey);
  }

  async callApi(prompt: string): Promise<ProviderResponse> {
    const body = {
      model: this.modelName,
      prompt,
      max_tokens: process.env.OPENAI_MAX_TOKENS || 1024,
      temperature: process.env.OPENAI_TEMPERATURE || 0,
    };
    logger.debug(`Calling OpenAI API: ${JSON.stringify(body)}`);
    let response, data;
    try {
      response = await fetchWithTimeout(
        `https://${this.apiHost}/v1/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        },
        REQUEST_TIMEOUT_MS,
      );

      data = (await response.json()) as unknown as any;
    } catch (err) {
      return {
        error: `API call error: ${String(err)}`,
      };
    }
    logger.debug(`\tOpenAI API response: ${JSON.stringify(data)}`);
    try {
      return {
        output: data.choices[0].text,
        tokenUsage: {
          total: data.usage.total_tokens,
          prompt: data.usage.prompt_tokens,
          completion: data.usage.completion_tokens,
        },
      };
    } catch (err) {
      return {
        error: `API response error: ${String(err)}: ${JSON.stringify(data)}`,
      };
    }
  }
}

export class OpenAiChatCompletionProvider extends OpenAiGenericProvider {
  static OPENAI_CHAT_MODELS = [
    'gpt-4',
    'gpt-4-0314',
    'gpt-4-32k',
    'gpt-4-32k-0314',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-0301',
  ];

  constructor(modelName: string, apiKey?: string) {
    if (!OpenAiChatCompletionProvider.OPENAI_CHAT_MODELS.includes(modelName)) {
      logger.warn(`Using unknown OpenAI chat model: ${modelName}`);
    }
    super(modelName, apiKey);
  }

  async callApi(prompt: string): Promise<ProviderResponse> {
    let messages: { role: string; content: string }[];
    try {
      // User can specify `messages` payload as JSON, or we'll just put the
      // string prompt into a `messages` array.
      messages = JSON.parse(prompt);
    } catch (err) {
      messages = [{ role: 'user', content: prompt }];
    }
    const body = {
      model: this.modelName,
      messages: messages,
      max_tokens: process.env.OPENAI_MAX_TOKENS || 1024,
      temperature: process.env.OPENAI_MAX_TEMPERATURE || 0,
    };
    logger.debug(`Calling OpenAI API: ${JSON.stringify(body)}`);

    let response, data;
    try {
      response = await fetchWithTimeout(
        `https://${this.apiHost}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        },
        REQUEST_TIMEOUT_MS,
      );
      data = (await response.json()) as unknown as any;
    } catch (err) {
      return {
        error: `API call error: ${String(err)}`,
      };
    }

    logger.debug(`\tOpenAI API response: ${JSON.stringify(data)}`);
    try {
      return {
        output: data.choices[0].message.content,
        tokenUsage: {
          total: data.usage.total_tokens,
          prompt: data.usage.prompt_tokens,
          completion: data.usage.completion_tokens,
        },
      };
    } catch (err) {
      return {
        error: `API response error: ${String(err)}: ${JSON.stringify(data)}`,
      };
    }
  }
}

export async function loadApiProvider(providerPath: string): Promise<ApiProvider> {
  if (providerPath?.startsWith('openai:')) {
    // Load OpenAI module
    const options = providerPath.split(':');
    const modelType = options[1];
    const modelName = options[2];

    if (modelType === 'chat') {
      return new OpenAiChatCompletionProvider(modelName || 'gpt-3.5-turbo');
    } else if (modelType === 'completion') {
      return new OpenAiCompletionProvider(modelName || 'text-davinci-003');
    } else if (OpenAiChatCompletionProvider.OPENAI_CHAT_MODELS.includes(modelType)) {
      return new OpenAiChatCompletionProvider(modelType);
    } else if (OpenAiCompletionProvider.OPENAI_COMPLETION_MODELS.includes(modelType)) {
      return new OpenAiCompletionProvider(modelType);
    } else {
      throw new Error(
        `Unknown OpenAI model type: ${modelType}. Use one of the following providers: openai:chat:<model name>, openai:completion:<model name>`,
      );
    }
  }

  // Load custom module
  const CustomApiProvider = (await import(path.join(process.cwd(), providerPath))).default;
  return new CustomApiProvider();
}
