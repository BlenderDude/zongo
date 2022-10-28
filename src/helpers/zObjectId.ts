import { z } from "zod";
import { ObjectId } from "mongodb";

export function zObjectId() {
  return z.instanceof(ObjectId);
}
