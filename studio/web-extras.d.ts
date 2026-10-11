interface FolioBridgeResult {
  ok?: boolean;
  name?: string;
  path?: string;
  text?: string;
}

interface Window {
  webkit?: {
    messageHandlers?: {
      folio?: { postMessage: (body: unknown) => Promise<FolioBridgeResult> };
    };
  };
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options?: {
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle[]>;
}
