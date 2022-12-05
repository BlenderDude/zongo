import { Db, MongoClient } from "mongodb";
import { z } from "zod";
import { ZCollectionDefinition } from "./types/ZCollectionDefinition";
import { ZDatabase } from "./types/ZDatabase";
import { ZPartialDefinition } from "./types/ZPartialDefinition";

export function createDatabase(client: MongoClient, db: Db) {
  return new ZDatabase(client, db);
}

export function createDefinition<
  ModelName extends string,
  Schema extends z.ZodSchema<any>
>(name: ModelName, schema: Schema) {
  return new ZCollectionDefinition(name, schema);
}

export function createPartial<
  Name extends string,
  Schema extends z.ZodSchema<any>
>(name: Name, schema: Schema) {
  return new ZPartialDefinition(name, schema);
}
