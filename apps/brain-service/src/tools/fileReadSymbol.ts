import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  FileReadSymbolRequestSchema,
  type FileReadSymbolRequest,
  type FileReadSymbolResponse,
} from '@migrapilot/protocol';

type SupportedSymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'method'
  | 'variable'
  | 'unknown';

type Match = {
  symbolName: string;
  kind: SupportedSymbolKind;
  startLine: number;
  endLine: number;
  content: string;
};

function getNodeName(node: ts.Node): string | null {
  if (
    ts.isFunctionDeclaration(node)
    || ts.isClassDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isEnumDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isVariableDeclaration(node)
  ) {
    if (node.name && ts.isIdentifier(node.name)) {
      return node.name.text;
    }
  }

  return null;
}

function getNodeKind(node: ts.Node): SupportedSymbolKind {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isMethodDeclaration(node)) return 'method';
  if (ts.isVariableDeclaration(node)) return 'variable';
  return 'unknown';
}

function isSupportedDeclaration(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node)
    || ts.isClassDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isEnumDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isVariableDeclaration(node)
  );
}

function buildMatch(sourceFile: ts.SourceFile, node: ts.Node): Match | null {
  if (!isSupportedDeclaration(node)) {
    return null;
  }

  const symbolName = getNodeName(node);
  if (!symbolName) {
    return null;
  }

  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

  return {
    symbolName,
    kind: getNodeKind(node),
    startLine: start.line + 1,
    endLine: end.line + 1,
    content: sourceFile.text.slice(node.getStart(sourceFile), node.getEnd()),
  };
}

function collectMatches(sourceFile: ts.SourceFile): Match[] {
  const matches: Match[] = [];

  function visit(node: ts.Node): void {
    const match = buildMatch(sourceFile, node);
    if (match) {
      matches.push(match);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return matches;
}

function isTsLikeFile(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath);
}

function getScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.ts')) return ts.ScriptKind.TS;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

export async function fileReadSymbol(
  input: FileReadSymbolRequest,
): Promise<FileReadSymbolResponse> {
  const req = FileReadSymbolRequestSchema.parse(input);
  const absPath = path.resolve(req.rootPath, req.path);

  if (!isTsLikeFile(req.path)) {
    throw new Error('file.readSymbol currently supports TS/JS files only.');
  }

  const raw = fs.readFileSync(absPath, 'utf8');
  const sourceFile = ts.createSourceFile(
    absPath,
    raw,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(req.path),
  );

  const matches = collectMatches(sourceFile);

  if (req.symbolName) {
    const exact = matches.find((match) => match.symbolName === req.symbolName);
    if (!exact) {
      throw new Error(`Symbol not found: ${req.symbolName}`);
    }

    return {
      tool: 'file.readSymbol',
      path: req.path,
      symbolName: exact.symbolName,
      kind: exact.kind,
      range: {
        startLine: exact.startLine,
        endLine: exact.endLine,
      },
      content: exact.content,
    };
  }

  if (req.line) {
    const enclosing = matches
      .filter((match) => req.line! >= match.startLine && req.line! <= match.endLine)
      .sort((left, right) => {
        const leftSize = left.endLine - left.startLine;
        const rightSize = right.endLine - right.startLine;
        return leftSize - rightSize;
      })[0];

    if (!enclosing) {
      throw new Error(`No supported symbol found at line ${req.line}`);
    }

    return {
      tool: 'file.readSymbol',
      path: req.path,
      symbolName: enclosing.symbolName,
      kind: enclosing.kind,
      range: {
        startLine: enclosing.startLine,
        endLine: enclosing.endLine,
      },
      content: enclosing.content,
    };
  }

  throw new Error('file.readSymbol requires either symbolName or line.');
}