import fs from "fs";
import path from "path";
// @ts-ignore
import solc from "solc";

function findImports(importPath: string) {
  if (importPath.startsWith("@openzeppelin/")) {
    const fullPath = path.resolve(process.cwd(), "node_modules", importPath);
    if (fs.existsSync(fullPath)) {
      return { contents: fs.readFileSync(fullPath, "utf-8") };
    }
  }

  const localPath = path.resolve(process.cwd(), "contracts", importPath);
  if (fs.existsSync(localPath)) {
    return { contents: fs.readFileSync(localPath, "utf-8") };
  }

  return { error: `File not found: ${importPath}` };
}

export function compileContracts() {
  console.log("Compiling BizArc Solidity smart contracts...");

  const contractsDir = path.resolve(process.cwd(), "contracts");
  const sources: Record<string, { content: string }> = {};

  const files = [
    "interfaces/IERC4626Yield.sol",
    "CentralTreasuryYieldVault.sol",
    "DisbursalVault.sol",
    "MockUSYCVault.sol",
  ];

  for (const file of files) {
    const filePath = path.join(contractsDir, file);
    sources[file] = { content: fs.readFileSync(filePath, "utf-8") };
  }

  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

  if (output.errors) {
    let hasFatal = false;
    for (const error of output.errors) {
      if (error.severity === "error") {
        console.error("COMPILE ERROR:", error.formattedMessage);
        hasFatal = true;
      } else {
        console.warn("COMPILE WARNING:", error.formattedMessage);
      }
    }
    if (hasFatal) {
      throw new Error("Solidity compilation failed.");
    }
  }

  const artifactsDir = path.resolve(process.cwd(), "artifacts/contracts");
  fs.mkdirSync(artifactsDir, { recursive: true });

  const compiledArtifacts: Record<string, { abi: unknown[]; bytecode: string }> = {};

  for (const [file, contractObj] of Object.entries(output.contracts as Record<string, any>)) {
    for (const [name, data] of Object.entries(contractObj)) {
      const artifact = {
        contractName: name,
        sourceName: file,
        abi: data.abi,
        bytecode: "0x" + data.evm.bytecode.object,
      };

      compiledArtifacts[name] = artifact;
      fs.writeFileSync(
        path.join(artifactsDir, `${name}.json`),
        JSON.stringify(artifact, null, 2)
      );
      console.log(`✓ Compiled: ${name} -> artifacts/contracts/${name}.json`);
    }
  }

  // Also write generated ABI TypeScript file in src/contracts/
  const contractsSrcDir = path.resolve(process.cwd(), "src/contracts");
  fs.mkdirSync(contractsSrcDir, { recursive: true });

  const tsExportContent = `// Auto-generated ABI exports
export const CentralTreasuryYieldVaultABI = ${JSON.stringify(compiledArtifacts["CentralTreasuryYieldVault"]?.abi, null, 2)} as const;
export const CentralTreasuryYieldVaultBytecode = "${compiledArtifacts["CentralTreasuryYieldVault"]?.bytecode}" as const;

export const DisbursalVaultABI = ${JSON.stringify(compiledArtifacts["DisbursalVault"]?.abi, null, 2)} as const;
export const DisbursalVaultBytecode = "${compiledArtifacts["DisbursalVault"]?.bytecode}" as const;

export const MockUSYCVaultABI = ${JSON.stringify(compiledArtifacts["MockUSYCVault"]?.abi, null, 2)} as const;
export const MockUSYCVaultBytecode = "${compiledArtifacts["MockUSYCVault"]?.bytecode}" as const;
`;

  fs.writeFileSync(path.join(contractsSrcDir, "artifacts.ts"), tsExportContent);
  console.log(`✓ Generated TypeScript ABI exports -> src/contracts/artifacts.ts`);

  return compiledArtifacts;
}

if (process.argv[1]?.endsWith("compileContracts.ts")) {
  compileContracts();
}
