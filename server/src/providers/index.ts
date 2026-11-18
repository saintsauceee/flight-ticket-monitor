import type { Config } from '../config';
import { MockProvider } from './mock/provider';
import { SerpApiProvider } from './serpapi/provider';
import type { FlightProvider } from './types';

export function createProvider(config: Config): FlightProvider {
  if (config.provider === 'serpapi') {
    return new SerpApiProvider({
      apiKey: config.serpapi.apiKey as string,
      gl: config.serpapi.gl,
      deepSearch: config.serpapi.deepSearch,
    });
  }
  return new MockProvider();
}

export * from './types';
