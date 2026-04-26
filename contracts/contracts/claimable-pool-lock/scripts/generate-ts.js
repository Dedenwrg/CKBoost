#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const schemaPath = path.join(rootDir, "schemas", "claimable-pool-lock.mol");
const generatedDir = path.join(rootDir, "ts", "src", "generated");
const metadataDir = path.join(rootDir, "ts", "generated");
const jsonPath = path.join(metadataDir, "claimable-pool.json");
const tsPath = path.join(generatedDir, "claimable-pool.ts");
const indexPath = path.join(generatedDir, "index.ts");

const BUILTIN_TYPES = new Set([
  "Uint8",
  "Uint16",
  "Uint32",
  "Uint64",
  "Uint128",
  "Uint256",
  "Byte32",
  "Bytes",
  "BytesOpt",
  "BytesVec",
  "Byte32Vec",
  "Byte32Opt",
  "Uint8Vec",
  "Uint16Vec",
  "Uint32Vec",
  "Uint64Vec",
  "Uint128Vec",
  "Uint256Vec",
  "Script",
  "OutPoint",
  "CellInput",
  "CellOutput",
  "CellDep",
  "RawTransaction",
  "Transaction",
  "WitnessArgs",
  "ScriptOpt",
  "ScriptVec",
  "CellDepVec",
  "CellInputVec",
  "CellOutputVec",
  "TransactionVec",
  "String",
  "Header",
  "UncleBlock",
  "Block",
  "BlockV1",
]);

const customArrayTypes = new Set();

function getLikeFieldType(type) {
  if (type === "byte") return "ccc.NumLike";
  if (
    [
      "Uint8",
      "Uint16",
      "Uint32",
      "Uint64",
      "Uint128",
      "Uint256",
    ].includes(type)
  ) {
    return "ccc.NumLike";
  }
  if (type === "Byte32") return "ccc.HexLike";
  if (type === "Bytes") return "ccc.BytesLike";
  if (type === "BytesOpt") return "ccc.BytesLike | null";
  if (type === "BytesVec") return "ccc.BytesLike[]";
  if (type === "Byte32Vec") return "ccc.HexLike[]";
  if (type === "Byte32Opt") return "ccc.HexLike | null";
  if (type === "String") return "string";
  if (type === "StringVec") return "string[]";
  if (customArrayTypes.has(type)) return "ccc.BytesLike";
  if (type.endsWith("Vec")) return `${type.slice(0, -3)}Like[]`;
  if (type.endsWith("Opt")) return `${type.slice(0, -3)}Like | null`;
  return `${type}Like`;
}

function getCodecReference(type) {
  if (type === "byte") return "mol.Uint8";
  if (type === "Uint8") return "mol.Uint8";
  if (type === "Uint8Vec") return "mol.Uint8Vec";
  if (type === "Uint16") return "mol.Uint16";
  if (type === "Uint32") return "mol.Uint32";
  if (type === "Uint64") return "mol.Uint64";
  if (type === "Uint128") return "mol.Uint128";
  if (type === "Uint256") return "mol.Uint256";
  if (type === "Byte32") return "mol.Byte32";
  if (type === "Bytes") return "mol.Bytes";
  if (type === "BytesOpt") return "mol.BytesOpt";
  if (type === "BytesVec") return "mol.BytesVec";
  if (type === "Byte32Vec") return "mol.Byte32Vec";
  if (type === "Byte32Opt") return "mol.Byte32Opt";
  if (type === "Uint128Vec") return "mol.Uint128Vec";
  if (type === "String") return "mol.String";
  if (type === "Script") return "ccc.Script";
  if (type === "OutPoint") return "ccc.OutPoint";
  if (type === "CellInput") return "ccc.CellInput";
  if (type === "CellOutput") return "ccc.CellOutput";
  if (type === "CellDep") return "ccc.CellDep";
  if (type === "RawTransaction") return "ccc.RawTransaction";
  if (type === "Transaction") return "ccc.Transaction";
  if (type === "WitnessArgs") return "ccc.WitnessArgs";
  if (type === "ScriptOpt") return "mol.option(ccc.Script)";
  if (type === "ScriptVec") return "mol.vector(ccc.Script)";
  if (type === "CellDepVec") return "mol.vector(ccc.CellDep)";
  if (type === "CellInputVec") return "mol.vector(ccc.CellInput)";
  if (type === "CellOutputVec") return "mol.vector(ccc.CellOutput)";
  if (type === "TransactionVec") return "mol.vector(ccc.Transaction)";
  if (type === "StringVec") return "mol.vector(mol.String)";
  return type;
}

function generateCodecForDeclaration(decl) {
  if (decl.type === "struct" || decl.type === "table") {
    const fields = (decl.fields ?? [])
      .map((field) => `  ${field.name}: ${getCodecReference(field.type)}`)
      .join(",\n");
    return `export const ${decl.name} = mol.${decl.type}({\n${fields}\n});\n`;
  }

  if (decl.type === "dynvec" || decl.type === "fixvec") {
    return `export const ${decl.name} = mol.vector(${getCodecReference(
      decl.item ?? "Bytes",
    )});\n`;
  }

  if (decl.type === "array") {
    if (typeof decl.item_count !== "number") {
      throw new Error(`Missing item_count for array ${decl.name}`);
    }
    return `export const ${decl.name} = mol.array(mol.Uint8, ${decl.item_count});\n`;
  }

  if (decl.type === "option") {
    return `export const ${decl.name} = mol.option(${getCodecReference(
      decl.item ?? "Bytes",
    )});\n`;
  }

  return "";
}

function generateTypeScript(schemaJson) {
  const schema = JSON.parse(schemaJson);
  customArrayTypes.clear();

  const customTypes = new Set();
  for (const decl of schema.declarations) {
    if (!BUILTIN_TYPES.has(decl.name)) {
      customTypes.add(decl.name);
      if (decl.type === "array") {
        customArrayTypes.add(decl.name);
      }
    }
  }

  const dependencies = new Map();
  for (const decl of schema.declarations) {
    if (!customTypes.has(decl.name)) continue;
    const deps = new Set();
    if (
      (decl.type === "dynvec" ||
        decl.type === "fixvec" ||
        decl.type === "option") &&
      decl.item &&
      customTypes.has(decl.item)
    ) {
      deps.add(decl.item);
    }
    if ((decl.type === "struct" || decl.type === "table") && decl.fields) {
      for (const field of decl.fields) {
        if (customTypes.has(field.type)) deps.add(field.type);
      }
    }
    dependencies.set(decl.name, deps);
  }

  const sorted = [];
  const visited = new Set();
  const visiting = new Set();
  function visit(name) {
    if (visited.has(name) || visiting.has(name)) return;
    visiting.add(name);
    for (const dep of dependencies.get(name) ?? []) {
      visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    sorted.push(name);
  }
  for (const name of customTypes) visit(name);

  let output = `// Auto-generated TypeScript types for claimable-pool-lock molecule schema\n`;
  output += `// This file is generated by contracts/contracts/claimable-pool-lock/scripts/generate-ts.js\n\n`;
  output += `import { mol, ccc } from "@ckb-ccc/core";\n\n`;
  output += `// Molecule codec implementations\n`;

  for (const typeName of sorted) {
    const decl = schema.declarations.find((item) => item.name === typeName);
    if (decl) output += generateCodecForDeclaration(decl);
  }

  output += `\nexport type CellDepVecLike = ccc.CellDepLike[];\n`;
  output += `export type Byte32VecLike = ccc.HexLike[];\n\n`;

  for (const typeName of sorted) {
    const decl = schema.declarations.find((item) => item.name === typeName);
    if (!decl || (decl.type !== "struct" && decl.type !== "table")) continue;
    output += `export interface ${typeName}Like {\n`;
    for (const field of decl.fields ?? []) {
      output += `  ${field.name}: ${getLikeFieldType(field.type)};\n`;
    }
    output += `}\n\n`;
  }

  return output;
}

function main() {
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.mkdirSync(metadataDir, { recursive: true });

  const schemaJson = execFileSync(
    "moleculec",
    ["--language", "-", "--schema-file", schemaPath, "--format", "json"],
    {
      cwd: rootDir,
      encoding: "utf8",
    },
  );

  fs.writeFileSync(jsonPath, schemaJson);
  fs.writeFileSync(tsPath, generateTypeScript(schemaJson));
  fs.writeFileSync(indexPath, 'export * from "./claimable-pool.js";\n');

  console.log(`Generated ${jsonPath}`);
  console.log(`Generated ${tsPath}`);
  console.log(`Generated ${indexPath}`);
}

main();
