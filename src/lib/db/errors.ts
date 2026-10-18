/** Thrown when an invoice number collides with an existing one (UNIQUE constraint). */
export class DuplicateInvoiceNumberError extends Error {
  constructor(public readonly number: string) {
    super(`Invoice number "${number}" is already used. Pick another one.`);
    this.name = "DuplicateInvoiceNumberError";
  }
}
