/** Thrown by the parsers; carries every problem found, not just the first. */
export class DataError extends Error {
  constructor(public problems: string[]) {
    super(problems.join("\n"));
  }
}
