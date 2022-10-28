import { Collection } from "mongodb";
import { z } from "zod";
import {
  ZCollectionBranded,
  ZCollectionDefinition,
} from "./ZCollectionDefinition";

export type ZCollection<Definition extends ZCollectionDefinition<any, any>> =
  Collection<z.infer<ZCollectionBranded<Definition>>>;
