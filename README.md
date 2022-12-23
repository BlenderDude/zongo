# Zongo

#### De-normalization, simplified!

Utilizing [zod](https://github.com/colinhacks/zod) to create a rich, fully-typed MongoDB document management
system. With static analysis of the document graph, de-normalization can become a treat rather than a burden!

## Goals

- Identify and define constraints of the documents at compile time
- Utilize and expand on `zod` to automatically create type safety
- Build static analysis tools on the document models
- Create embedding system that allows for easy de-normalized modelling
- Automatically apply de-normalized updates in a transaction

## Getting Started

#### Your first definition

Definitions in zongo are defined by a name and a schema. Let's create a simple
example for a user definition with a name and age.

```typescript
// user.ts
import { z } from "zod";
import { zg } from "zongo";

export const userDefinition = zg.createDefinition(
  "User",
  z.strictObject({
    _id: zg.schema.objectId(),
    name: z.string(),
    age: z.number(),
    pets: z.array(z.string()),
  })
);
```

#### Adding it to a database

Now that you have a simple definition you can add it to the database by
chaining a `createDatabase` call to a `addDefinition` call. The resultant
`zdb` variable will contain the fully typed database.

```typescript
// zdb.ts
import {userDefinition} from "./user";
import {zg} from "zongo";
import {MongoClient} from "mongodb";

const client = new MongoClient(...);
const db = client.db("main");

export const zdb = zg.createDatabase(client, db)
  .addDefinition(userDefinition);
```

#### Creating a document

After creating your `zdb` it provides many helper functions for document manipulation.
One of the goals of this library is to stay "out of the way" of the mongodb native driver
and only add typings and helpers where necessary. Creating a document is one of them.

```typescript
// index.ts
import { zdb } from "./zdb";
import { ObjectId } from "mongodb";

async function main() {
  const user = await zdb.create("User", {
    _id: new ObjectId(),
    name: "Daniel",
    age: 22,
    pets: ["George", "Rascal"],
  });
}

void main();
```

The resultant type `user` will be fully typed based on the zod schema defined in the `userDefinition` file, utilizing `z.output<typeof schema>` internally. The value passed as the second argument to `create` is also strictly typed with `z.input<typeof schema>` internally.

#### Hydrating a document

As mentioned previously, zongo strives to stay out of the way from mongodb as much as possible. Given that, `zdb` exposes a `hydrate` method that utilizes a callback with a native mongodb collection.

```typescript
import { zdb } from "./zdb";
import { ObjectId } from "mongodb";

async function main() {
  const _id = new ObjectId("...");
  const user = await zdb.hydrate("User", (collection) => {
    return collection.findOne({ _id });
  });
}

void main();
```

#### Updating a document (via zdb)

There are two ways to update a document using the `update` helper. The first option is to pass an object, where the first-level keys will be overridden by whatever is passed. For array manipulation or multi-level merging, option two utilizes a callback with a mutable document.

```typescript
import { zdb } from "./zdb";
import { ObjectId } from "mongodb";

async function main() {
  const _id = new ObjectId("...");

  // Option 1
  await zdb.update("User", _id, {
    name: "Danielle",
  });

  // Option 2
  await zdb.update("Update", _id, (doc) => {
    // The doc is accepted to be mutable, no need for immutable updates
    doc.name = "Danielle";
    // Arrays and objects can be directly mutated!
    doc.pets.push("Willow");
    return doc;
  });
}

void main();
```

#### Creating a document reference

We are currently storing pets as an array of strings. This is great, but pets might be better stored in their own collection. Let's create a new collection for the pets and added to our zongo database.

```typescript
// pet.ts
import { z } from "zod";
import { zg } from "zongo";

export const petDefinition = zg.createDefinition(
  "Pet",
  z.strictObject({
    _id: zg.schema.objectId(),
    name: z.string(),
    type: z.enum(["cat", "horse"]),
    favoriteTreats: z.array(z.string()),
  })
);

// zdb.ts
import {userDefinition} from "./user";
import {petDefinition} from "./pet";
import {zg} from "zongo";
import {MongoClient} from "mongodb";

const client = new MongoClient(...);
const db = client.db("main");

export const zdb = zg.createDatabase(client, db)
  .addDefinition(userDefinition)
  .addDefinition(petDefinition)

```

The user definition needs to be updated as well. This will utilize the `zg.schema.document` helpers. There are a few options when embedding a document.

- `ref` will only store the `_id` of the referenced document
- `partial` will only store specific keys from the referenced document
- `full` will embed the entire document

Let's update the `userDefinition` to store a partial of the `petDefinition`, only keeping the `name` and `type`.

```typescript
// user.ts
import { z } from "zod";
import { zg } from "zongo";
import { petDefinition } from "./pet";

export const userDefinition = zg.createDefinition(
  "User",
  z.strictObject({
    _id: zg.schema.objectId(),
    name: z.string(),
    age: z.number(),
    pets: z.array(
      z.schema.document.partial(petDefinition, {
        name: true,
        type: true,
      })
    ),
  })
);
```

#### Accessing a document with references

The return value of a `ref`, `partial`, and `full` reference is a `DocumentReference`, not just the raw values. Let's see how that is utilized. First let's redo our main to create 3 documents.

```typescript
// index.ts
import { zdb } from "./zdb";
import { ObjectId } from "mongodb";

async function main() {
  const george = await zdb.create("Pet", {
    _id: new ObjectId(),
    name: "George",
    type: "cat",
    favoriteTreats: ["cardboard"],
  });
  const rascal = await adb.create("Pet", {
    _id: new ObjectId(),
    name: "Rascal",
    type: "cat",
    favoriteTreats: ["Chipotle cheese"],
  });
  const user = await zdb.create("User", {
    _id: new ObjectId(),
    name: "Daniel",
    age: 22,
    pets: [george, rascal],
  });
}

void main();
```

Next, when accessing the document, the references can be traversed with the `DocumentReference` class.

```typescript
// index.ts
import { zdb } from "./zdb";
import { ObjectId } from "mongodb";

async function main() {
  const _id = new ObjectId("...");
  const user = await zdb.hydrate("User", (c) => c.findOne({ _id }));
  for (const pet of user.pets) {
    // Existing data can be accessed synchronously as it is
    // directly embedded with every user
    const { name, type } = pet.getExisting();
    console.log(`${user.name}'s pet ${type} named ${name}`);

    // If more data is needed, `resolve()` will get the
    // full document from the collection
    const { favoriteTreats } = await pet.resolve();
    console.log(`Favorite treats:`);
    for (const treat of favoriteTreats) {
      console.log(`  - ${treat}`);
    }
  }
}

void main();
```

#### Automatic reference updates

When references exist within the definitions, zongo handles the most time consuming part about de-normalized writes, updating other documents. For example, an update to a pet's name would require a subsequent update to the user's with that pet in their `pets` array. This can become tedious and is prone to errors.

With zongo, your schema is statically analyzed and can perform the subsequent updates automatically and efficiently. There are no restrictions on the way a document is nested within your schema. Nested arrays and objects will both update properly.

For example, updating a pet using `zdb.update` will automatically update all references to it.

```typescript
import { zdb } from "./zdb";
import { ObjectId } from "mongodb";

async function main() {
  const _userId = new ObjectId("...");
  const _petId = new ObjectId("...");

  await zdb.update("Pet", _petId, {
    name: "Georgie",
  });

  const user = await zdb.hydrate("Pet", (c) => c.findOne({ _id: _petId }));
  const { name } = user.pet.find((p) => p.id === _petId)!.getExisting();
  asset(name === "Georgie");
}

void main();
```

Note how in the code above, two documents were updated during the `zdb.update()` step. Not only was the "George" pet document updated, but the "Daniel" user received an update too. The `name` field was within the pet partial on the user definition, so it required an update or the cat would be `George` on the user document and `Georgie` on the pet document. This inconsistency is completely avoided by utilizing the zongo update method. 🎉

## Structure

Everything in this library will be based off the `zg` export. This can be imported in two ways

1. `import zg from "zongo";`
2. `import {zg} from "zongo";`

Both of these methods are supported and valid, but intellisense works better with strictly defined names so the second option is there for autocomplete. Option 1 has no requirement to be named `zg`, though I highly recommend it 😄

### Base Import

The base `zg` import contains all of the "create" functions. These will be used to instantiate something new, like
a database, collection definition, or partial definition.

```typescript
import {zg} from "zongo";

zg.createDefinition(...);
zg.createPartial(...);
zg.createDatabase(...);

```

### `zg.schema` module

In the `zg.schema` module, all functions that will be utilized within the context of a zod
schema can be found.

Drilling down further, there are two submodules `schema` and `types`.

## API (WIP)

### `zg`

#### `zg.createDatabase`

#### `zg.createDefinition`

#### `zg.createPartial`

### `zg.schema`

#### `zg.schema.document`

##### `zg.schema.document.full`

##### `zg.schema.document.partial`

##### `zg.schema.document.ref`

#### `zg.schema.objectId`

Simply an alias to `z.instanceOf(mongo.ObjectId)`. It is used quite a lot in document creation, to it is here simply as an alias helper. There is no internal significance of this function and if you wish to use `z.instanceOf(mongo.ObjectId)` instead, go ahead.

```typescript
import { zg } from "zongo";
import { z } from "zod";

const schema = z.strictObject({
  _id: zg.schema.objectId(),
});
```

#### `zg.schema.partial`

```typescript
zg.schema.partial<PD extends zg.types.PartialDefinition<any>>(partial: PD);
```

Instantiates a partial into a zod schema.

```typescript
import { zg } from "zongo";
import { z } from "zod";

const AuditEntry = z.createPartial(
  "AuditEntry",
  z.strictObject({
    action: z.string(),
    timestamp: z.date(),
  })
);

const schema = z.strictObject({
  auditLog: z.array(zg.partial(AuditEntry)),
});
```
