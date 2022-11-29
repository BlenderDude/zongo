import { z } from "zod";
import { ZDatabase } from "./ZDatabase";

export class ZPartialDefinition<
  Name extends string,
  Schema extends z.ZodSchema
> {
  private _zdb: ZDatabase<any, any> | null = null;
  set zdb(val: ZDatabase<any, any>) {
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

export type ZPartialSchema<T extends ZPartialDefinition<any, any>> =
  T extends ZPartialDefinition<any, infer S> ? S : never;
