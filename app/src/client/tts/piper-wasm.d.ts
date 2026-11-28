declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  export interface PiperPhonemizeOptions {
    print?: (line: string) => void;
    printErr?: (line: string) => void;
    locateFile?: (path: string, prefix: string) => string;
    wasmBinary?: ArrayBuffer;
    getPreloadedPackage?: (name: string, size: number) => ArrayBuffer | null;
    noInitialRun?: boolean;
  }

  export interface PiperPhonemizeModule {
    callMain: (args: string[]) => number;
  }

  export default function createPiperPhonemize(
    options?: PiperPhonemizeOptions,
  ): Promise<PiperPhonemizeModule>;
}
