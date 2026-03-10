declare module "@coffeeandfun/google-profanity-words" {
  export interface ProfanityEngineConfig {
    language?: "en" | "es";
    testMode?: boolean;
  }

  export class ProfanityEngine {
    constructor(config?: ProfanityEngineConfig);
    hasCurseWords(sentence: string): Promise<boolean>;
    getCurseWords(sentence: string): Promise<string[]>;
    all(): Promise<string[]>;
    search(term: string): Promise<boolean>;
    reset(): void;
  }
}
