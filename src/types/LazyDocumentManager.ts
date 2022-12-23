import { z } from "zod";
import {
  CollectionBranded,
  CollectionDefinition,
} from "./CollectionDefinition";
import { LazyDocument } from "./LazyDocument";

export class LazyDocumentManager<
  Definition extends CollectionDefinition<any, any>
> {
  constructor(private lazyDocument: LazyDocument<Definition>) {}

  async collect<
    Keys extends ReadonlyArray<keyof z.output<CollectionBranded<Definition>>>
  >(
    keys: Keys
  ): Promise<{
    [K in Keys[number]]: z.infer<CollectionBranded<Definition>>[K];
  }> {
    const promises = keys.map((key) => this.lazyDocument[key]);
    const resolvedKeyData = await Promise.all(promises);
    const keyEntries = resolvedKeyData.map((data, index) => [
      keys[index],
      data,
    ]);
    return Object.fromEntries(keyEntries);
  }
}
