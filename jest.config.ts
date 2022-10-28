import { defaults as tsjPreset } from "ts-jest/presets";

module.exports = {
  preset: "@shelf/jest-mongodb",
  transform: tsjPreset.transform,
};
