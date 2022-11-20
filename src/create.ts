import { Db } from "mongodb";
import { z } from "zod";
import { ZCollectionDefinition } from "./types/ZCollectionDefinition";
import { ZDatabase } from "./types/ZDatabase";

export function createDatabase(db: Db) {
  return new ZDatabase(db);
}

export function createDefinition<
  ModelName extends string,
  Schema extends z.ZodSchema<any>
>(name: ModelName, schema: Schema) {
  return new ZCollectionDefinition(name, schema);
}
