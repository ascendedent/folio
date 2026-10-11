export class FolioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FolioError";
  }
}
