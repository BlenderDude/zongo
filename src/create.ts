import { Db, MongoClient } from "mongodb";
import { z } from "zod";
import { CollectionDefinition } from "./types/CollectionDefinition";
import { Database } from "./types/Database";
import { PartialDefinition } from "./types/PartialDefinition";

export function createDatabase(client: MongoClient, db: Db) {
  return new Database(client, db);
}

export function createDefinition<
  ModelName extends string,
  Schema extends z.ZodSchema<any>
>(name: ModelName, schema: Schema) {
  return new CollectionDefinition(name, schema);
}

/**
 * Creates partial
 *
 * @param {Name} name
 * @param {Schema} schema
 */
export function createPartial<
  Name extends string,
  Schema extends z.ZodSchema<any>
>(name: Name, schema: Schema) {
  return new PartialDefinition(name, schema);
}
