import { Db, MongoClient, ObjectId } from "mongodb";
import { z } from "zod";
import {
  ZCollectionDefinition,
  ZDatabase,
  zObjectId,
  zEmbeddedSchema,
} from "./zongo";

function createZdb(db: Db) {
  const userDefinition = new ZCollectionDefinition(
    "User",
    z.object({
      _id: zObjectId(),
      name: z.string(),
    })
  );
  const postDefinition = new ZCollectionDefinition(
    "Post",
    z.object({
      _id: zObjectId(),
      name: z.string(),
      author: zEmbeddedSchema.partial(userDefinition, {
        name: true,
      }),
    })
  );
  const discriminatedDefinition = new ZCollectionDefinition(
    "DiscriminatedUnion",
    z.discriminatedUnion("_type", [
      z.object({ _id: zObjectId(), _type: z.literal("a"), a: z.string() }),
      z.object({ _id: zObjectId(), _type: z.literal("b"), b: z.string() }),
    ])
  );
  const refToDistDefinition = new ZCollectionDefinition(
    "RefToDiscriminatedUnion",
    z.object({
      _id: zObjectId(),
      testRef: zEmbeddedSchema.full(discriminatedDefinition),
    })
  );
  return new ZDatabase(db)
    .addDefinition(userDefinition)
    .addDefinition(postDefinition)
    .addDefinition(discriminatedDefinition)
    .addDefinition(refToDistDefinition);
}

describe("create", () => {
  let connection: MongoClient;
  let db: Db;

  beforeEach(async () => {
    connection = new MongoClient((globalThis as any).__MONGO_URI__ as string);
    await connection.connect();
    db = connection.db((globalThis as any).__MONGO_DB_NAME__ as string);
    await db.dropDatabase();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("create a basic zDatabase ", async () => {
    const zdb = createZdb(db);
    const expectedUser = {
      _id: new ObjectId(),
      name: "Daniel",
    };
    await zdb.create("User", expectedUser);
    const user = await zdb.getCollection("User").findOne({ name: "Daniel" });
    expect(user).toEqual(expectedUser);
  });

  it("create a basic zDatabase with a reference", async () => {
    const zdb = createZdb(db);
    const expectedUser = {
      _id: new ObjectId(),
      name: "Daniel",
    };
    const expectedPost = {
      _id: new ObjectId(),
      name: "Post 1",
      author: expectedUser,
    };
    await zdb.create("User", expectedUser);
    await zdb.create("Post", expectedPost);

    const post = await zdb.getCollection("Post").findOne({ name: "Post 1" });
    const rPost = await zdb.resolveReferences(post);
    expect(rPost).toEqual(expectedPost);
    const user = await zdb.getCollection("User").findOne({ name: "Daniel" });
    expect(user).toEqual(expectedUser);
  });

  it("creates records with discriminated types", async () => {
    const zdb = createZdb(db);
    const expectedA = {
      _id: new ObjectId(),
      _type: "a" as const,
      a: "a",
    };
    const expectedB = {
      _id: new ObjectId(),
      _type: "b" as const,
      b: "b",
    };
    await zdb.create("DiscriminatedUnion", expectedA);
    await zdb.create("DiscriminatedUnion", expectedB);
    const a = await zdb
      .getCollection("DiscriminatedUnion")
      .findOne({ _type: "a" });
    expect(a).toEqual(expectedA);
    const b = await zdb
      .getCollection("DiscriminatedUnion")
      .findOne({ _type: "b" });
    expect(b).toEqual(expectedB);
  });
  describe("discriminated unions", () => {
    it("creates _id reference", async () => {
      const zdb = createZdb(db);
      const expectedA = {
        _id: new ObjectId(),
        _type: "a" as const,
        a: "a",
      };
      const a = await zdb.create("DiscriminatedUnion", expectedA);

      const res = await zdb.create("RefToDiscriminatedUnion", {
        _id: new ObjectId(),
        testRef: a._id,
      });

      expect(expectedA).toEqual(a);
      expect(res.testRef).toEqual(a);
    });
    it("creates full reference", async () => {
      const zdb = createZdb(db);
      const expectedA = {
        _id: new ObjectId(),
        _type: "a" as const,
        a: "a",
      };
      const a = await zdb.create("DiscriminatedUnion", expectedA);

      const res = await zdb.create("RefToDiscriminatedUnion", {
        _id: new ObjectId(),
        testRef: a,
      });

      expect(expectedA).toEqual(a);
      expect(res.testRef).toEqual(a);
    });
  });
});
