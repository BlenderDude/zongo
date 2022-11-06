import { Db, MongoClient, ObjectId } from "mongodb";
import { z } from "zod";
import { ZDocumentReference } from "./types/ZDocumentReference";
import {
  ZCollectionDefinition,
  ZDatabase,
  zObjectId,
  zEmbeddedSchema,
} from "./zongo";

function expectDocumentsToMatch(actual: any, expected: any) {
  function serialize(obj: any) {
    function replacer(key: string, value: any) {
      if (value instanceof ObjectId) {
        return value.toHexString();
      }
      if (value instanceof ZDocumentReference) {
        return `ZDocumentReference(${value.definition.modelName},${value._id})`;
      }
      return value;
    }
    return JSON.parse(JSON.stringify(obj, replacer));
  }
  expect(serialize(actual)).toEqual(serialize(expected));
}

function createZdb(db: Db) {
  const photoDefinition = new ZCollectionDefinition(
    "Photo",
    z.object({
      _id: zObjectId(),
      url: z.string(),
      description: z.string(),
    })
  );
  const userDefinition = new ZCollectionDefinition(
    "User",
    z.object({
      _id: zObjectId(),
      name: z.string(),
      photo: zEmbeddedSchema
        .partial(photoDefinition, {
          url: true,
        })
        .nullable(),
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
    .addDefinition(refToDistDefinition)
    .addDefinition(photoDefinition);
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
      photo: null,
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
      photo: null,
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
      expectDocumentsToMatch(await res.testRef.resolveFull(zdb), a);
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
      expectDocumentsToMatch(await res.testRef.resolveFull(zdb), a);
    });
  });
  it("traverses references automatically", async () => {
    const zdb = createZdb(db);
    const photo = await zdb.create("Photo", {
      _id: new ObjectId(),
      url: "https://example.com",
      description: "test",
    });
    const user = await zdb.create("User", {
      _id: new ObjectId(),
      name: "Daniel",
      photo,
    });
    const post = await zdb.create("Post", {
      _id: new ObjectId(),
      name: "Post 1",
      author: user,
    });

    const dPost = await zdb.getCollection("Post").findOne(post._id);
    const dAuthor = await dPost?.author.resolveFull(zdb);
    const dPhoto = await dAuthor?.photo?.resolveFull(zdb);

    expectDocumentsToMatch(dPost, post);
    expectDocumentsToMatch(dAuthor, user);
    expectDocumentsToMatch(dPhoto, photo);
  });
});
