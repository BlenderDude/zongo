import { z } from "zod";
import { Database } from "./Database";

export class PartialDefinition<
  Name extends string,
  Schema extends z.ZodSchema
> {
  private _zdb: Database<any, any> | null = null;
  set zdb(val: Database<any, any>) {
    this._zdb = val;
  }
  get zdb() {
    if (!this._zdb) {
      throw new Error("ZDB not set");
    }
    return this._zdb;
  }

  constructor(public name: Name, public schema: Schema) {}
}

export type PartialSchema<T extends PartialDefinition<any, any>> =
  T extends PartialDefinition<any, infer S> ? S : never;

export type PartialName<T extends PartialDefinition<any, any>> =
  T extends PartialDefinition<infer N, any> ? N : never;
