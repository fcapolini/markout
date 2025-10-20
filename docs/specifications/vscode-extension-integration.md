# VS Code Extension Integration for Fragment Library Resolution

## Overview

The upcoming VS Code extension will need sophisticated integration with the enhanced preprocessor to provide IntelliSense, error diagnostics, and import resolution for fragment libraries. This document outlines the architectural requirements for language server protocol (LSP) integration.

## Current Error Handling Architecture

### Existing Diagnostic System

Markout already has a robust error handling system that can be extended for VS Code integration:

```typescript
// Current PageError class in parser.ts
export class PageError {
  type: 'error' | 'warning';
  msg: string;
  loc?: acorn.SourceLocation;  // Contains source, line, column information
}

// Source class provides error collection
export class Source {
  errors: PageError[];
  addError(type: 'error' | 'warning', msg: string, loc: SourceLocation) {
    this.errors.push(new PageError(type, msg, loc));
  }
}
```

### Current Error Categories
- **Parser Errors**: Invalid HTML syntax, malformed expressions
- **Compiler Errors**: Invalid JavaScript expressions, type validation
- **Preprocessor Errors**: Failed fragment loading, circular dependencies
- **Validator Errors**: Framework rule violations, forbidden identifiers

## Enhanced Preprocessor Requirements for VS Code

### Package Resolution Diagnostics

**1. Import Resolution Errors**
```typescript
// Enhanced error types needed for VS Code
export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface ImportDiagnostic extends PageError {
  category: 'import-resolution';
  code: ImportErrorCode;
  resolvedPath?: string;
  suggestions?: string[];
  packageInfo?: PackageInfo;
}

export enum ImportErrorCode {
  PACKAGE_NOT_FOUND = 'package-not-found',
  PACKAGE_NOT_ALLOWED = 'package-not-allowed', 
  FILE_NOT_FOUND = 'file-not-found',
  CIRCULAR_DEPENDENCY = 'circular-dependency',
  INVALID_PACKAGE_NAME = 'invalid-package-name',
  VERSION_MISMATCH = 'version-mismatch'
}
```

**2. Package Information for IntelliSense**
```typescript
export interface PackageInfo {
  name: string;
  version: string;
  resolvedPath: string;
  packageJsonPath: string;
  availableFiles: string[];
  dependencies?: string[];
  description?: string;
  isOfficialMarkout: boolean;
}

export interface FragmentInfo {
  path: string;
  exports: ComponentExport[];
  dependencies: string[];
  documentation?: string;
}

export interface ComponentExport {
  name: string;
  type: 'component' | 'define' | 'data-service';
  parameters?: Parameter[];
  documentation?: string;
}
```

### Enhanced Preprocessor Interface

**1. Diagnostic-Aware Preprocessor**
```typescript
export interface PreprocessorOptions {
  docroot: string;
  enableDiagnostics?: boolean;
  allowedPackagePatterns?: string[];
  packageResolutionCache?: Map<string, PackageInfo>;
}

export class DiagnosticPreprocessor extends Preprocessor {
  options: PreprocessorOptions;
  packageCache: Map<string, PackageInfo>;
  diagnostics: ImportDiagnostic[];

  constructor(options: PreprocessorOptions) {
    super(options.docroot);
    this.options = options;
    this.packageCache = options.packageResolutionCache || new Map();
    this.diagnostics = [];
  }

  // Enhanced package resolution with detailed diagnostics
  async resolvePackageWithDiagnostics(
    packagePath: string, 
    fromDir: string,
    from?: ServerElement
  ): Promise<PackageResolutionResult> {
    // Implementation details below...
  }
}
```

**2. Package Resolution Results**
```typescript
export interface PackageResolutionResult {
  success: boolean;
  resolvedPath?: string;
  packageInfo?: PackageInfo;
  diagnostics: ImportDiagnostic[];
  suggestions?: string[];
}

export class PackageResolver {
  static async resolvePackage(
    packagePath: string,
    fromDir: string,
    options: PreprocessorOptions
  ): Promise<PackageResolutionResult> {
    
    const result: PackageResolutionResult = {
      success: false,
      diagnostics: [],
      suggestions: []
    };

    try {
      // 1. Parse package path
      const { packageName, filePath } = this.parsePackagePath(packagePath);
      
      // 2. Security validation
      if (!this.isPackageAllowed(packageName, options)) {
        result.diagnostics.push({
          type: 'error',
          category: 'import-resolution',
          code: ImportErrorCode.PACKAGE_NOT_ALLOWED,
          msg: `Package "${packageName}" is not allowed`,
          suggestions: this.getSuggestedPackages(packageName)
        });
        return result;
      }

      // 3. Resolve package.json
      const packageJsonPath = require.resolve(`${packageName}/package.json`, {
        paths: [fromDir]
      });
      
      // 4. Load package info
      result.packageInfo = await this.loadPackageInfo(packageJsonPath);
      
      // 5. Resolve specific file
      const fullPath = path.join(
        path.dirname(packageJsonPath), 
        filePath
      );

      if (fs.existsSync(fullPath)) {
        result.success = true;
        result.resolvedPath = fullPath;
      } else {
        result.diagnostics.push({
          type: 'error',
          category: 'import-resolution', 
          code: ImportErrorCode.FILE_NOT_FOUND,
          msg: `File "${filePath}" not found in package "${packageName}"`,
          suggestions: this.getSuggestedFiles(result.packageInfo, filePath)
        });
      }

    } catch (error) {
      result.diagnostics.push({
        type: 'error',
        category: 'import-resolution',
        code: ImportErrorCode.PACKAGE_NOT_FOUND,
        msg: `Package "${packageName}" not found`,
        suggestions: this.getSimilarPackages(packageName)
      });
    }

    return result;
  }
}
```

## VS Code Language Server Integration

### Language Server Protocol Implementation

**1. Diagnostic Provider**
```typescript
// VS Code extension implementation
export class MarkoutLanguageServer {
  connection: Connection;
  documents: TextDocuments<TextDocument>;
  preprocessor: DiagnosticPreprocessor;

  constructor() {
    this.connection = createConnection(ProposedFeatures.all);
    this.documents = new TextDocuments(TextDocument);
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Document change events
    this.documents.onDidChangeContent(this.validateDocument.bind(this));
    this.documents.onDidOpen(this.validateDocument.bind(this));
    
    // Language server capabilities
    this.connection.onInitialize(this.onInitialize.bind(this));
    this.connection.onCompletion(this.onCompletion.bind(this));
    this.connection.onCompletionResolve(this.onCompletionResolve.bind(this));
    this.connection.onHover(this.onHover.bind(this));
    this.connection.onDefinition(this.onDefinition.bind(this));
  }

  private async validateDocument(change: TextDocumentChangeEvent<TextDocument>) {
    const document = change.document;
    const source = await this.parseDocument(document);
    
    // Convert Markout diagnostics to VS Code diagnostics
    const diagnostics = this.convertDiagnostics(source.errors, source.diagnostics);
    
    this.connection.sendDiagnostics({
      uri: document.uri,
      diagnostics
    });
  }
}
```

**2. IntelliSense Features**

```typescript
// Completion provider for fragment imports
private async onCompletion(params: CompletionParams): Promise<CompletionItem[]> {
  const document = this.documents.get(params.textDocument.uri);
  if (!document) return [];

  const position = params.position;
  const line = document.getText().split('\n')[position.line];
  
  // Detect import context: <:import src="|
  if (this.isInImportContext(line, position.character)) {
    return this.getImportCompletions(document, position);
  }
  
  // Detect component usage context: <:component-name |
  if (this.isInComponentContext(line, position.character)) {
    return this.getComponentParameterCompletions(document, position);
  }
  
  return [];
}

private async getImportCompletions(
  document: TextDocument, 
  position: Position
): Promise<CompletionItem[]> {
  const completions: CompletionItem[] = [];
  
  // 1. Official @markout-js/* packages
  const officialPackages = await this.getAvailableOfficialPackages();
  for (const pkg of officialPackages) {
    completions.push({
      label: `@markout-js/${pkg.name}`,
      kind: CompletionItemKind.Module,
      detail: pkg.description,
      documentation: pkg.documentation,
      insertText: `@markout-js/${pkg.name}/lib/${pkg.mainFile}`,
      sortText: `0-${pkg.name}` // Priority sorting
    });
  }
  
  // 2. Community packages
  const communityPackages = await this.getAvailableCommunityPackages();
  for (const pkg of communityPackages) {
    completions.push({
      label: pkg.name,
      kind: CompletionItemKind.Module,
      detail: pkg.description,
      insertText: `${pkg.name}/lib/${pkg.mainFile}`,
      sortText: `1-${pkg.name}`
    });
  }
  
  // 3. Local file paths
  const localFiles = await this.getLocalFragmentFiles(document);
  for (const file of localFiles) {
    completions.push({
      label: file.relativePath,
      kind: CompletionItemKind.File,
      detail: file.description,
      insertText: file.relativePath,
      sortText: `2-${file.relativePath}`
    });
  }
  
  return completions;
}
```

**3. Error Diagnostics and Quick Fixes**

```typescript
// Convert Markout errors to VS Code diagnostics
private convertDiagnostics(
  errors: PageError[], 
  importDiagnostics: ImportDiagnostic[]
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  
  // Standard compilation errors
  for (const error of errors) {
    if (error.loc) {
      diagnostics.push({
        severity: this.convertSeverity(error.type),
        range: this.convertRange(error.loc),
        message: error.msg,
        source: 'markout'
      });
    }
  }
  
  // Import resolution errors with code actions
  for (const importError of importDiagnostics) {
    if (importError.loc) {
      const diagnostic: Diagnostic = {
        severity: this.convertSeverity(importError.type),
        range: this.convertRange(importError.loc),
        message: importError.msg,
        source: 'markout-imports',
        code: importError.code
      };
      
      // Add code actions for quick fixes
      if (importError.suggestions?.length) {
        diagnostic.data = {
          suggestions: importError.suggestions,
          packageInfo: importError.packageInfo
        };
      }
      
      diagnostics.push(diagnostic);
    }
  }
  
  return diagnostics;
}

// Code action provider for quick fixes
private async onCodeAction(params: CodeActionParams): Promise<CodeAction[]> {
  const actions: CodeAction[] = [];
  
  for (const diagnostic of params.context.diagnostics) {
    if (diagnostic.source === 'markout-imports' && diagnostic.data?.suggestions) {
      // Create quick fix actions for import suggestions
      for (const suggestion of diagnostic.data.suggestions) {
        actions.push({
          title: `Change to "${suggestion}"`,
          kind: CodeActionKind.QuickFix,
          edit: {
            changes: {
              [params.textDocument.uri]: [{
                range: diagnostic.range,
                newText: suggestion
              }]
            }
          }
        });
      }
    }
  }
  
  return actions;
}
```

### Package Discovery and Caching

**1. Package Registry Integration**
```typescript
export class PackageRegistryService {
  private cache = new Map<string, PackageInfo[]>();
  private lastUpdate = 0;
  
  async getAvailableOfficialPackages(): Promise<PackageInfo[]> {
    if (this.shouldRefreshCache()) {
      await this.refreshOfficialPackages();
    }
    return this.cache.get('official') || [];
  }
  
  async refreshOfficialPackages(): Promise<void> {
    try {
      // Query npm registry for @markout-js/* packages
      const response = await fetch('https://registry.npmjs.org/-/v1/search?text=scope:markout-js');
      const data = await response.json();
      
      const packages: PackageInfo[] = data.objects.map((obj: any) => ({
        name: obj.package.name,
        version: obj.package.version,
        description: obj.package.description,
        isOfficialMarkout: true
      }));
      
      this.cache.set('official', packages);
      this.lastUpdate = Date.now();
    } catch (error) {
      console.error('Failed to refresh official packages:', error);
    }
  }
}
```

**2. Local Fragment Discovery**
```typescript
export class LocalFragmentService {
  async discoverFragments(workspaceRoot: string): Promise<FragmentInfo[]> {
    const fragments: FragmentInfo[] = [];
    
    // Find all .htm files in workspace
    const htmFiles = await globby(['**/*.htm', '!node_modules/**'], {
      cwd: workspaceRoot,
      absolute: true
    });
    
    for (const file of htmFiles) {
      try {
        const fragmentInfo = await this.analyzeFragment(file);
        fragments.push(fragmentInfo);
      } catch (error) {
        // Log but don't fail for individual fragments
        console.warn(`Failed to analyze fragment ${file}:`, error);
      }
    }
    
    return fragments;
  }
  
  private async analyzeFragment(filePath: string): Promise<FragmentInfo> {
    const content = await fs.promises.readFile(filePath, 'utf8');
    const source = parse(content, filePath);
    
    // Extract component definitions
    const exports = this.extractComponentExports(source);
    
    // Extract dependencies
    const dependencies = this.extractDependencies(source);
    
    return {
      path: filePath,
      exports,
      dependencies,
      documentation: this.extractDocumentation(content)
    };
  }
}
```

## Implementation Roadmap

### Phase 1: Enhanced Preprocessor (v0.3.0)
- [ ] Add DiagnosticPreprocessor class
- [ ] Implement PackageResolver with detailed error reporting
- [ ] Add ImportDiagnostic types and error codes
- [ ] Create package discovery and caching system
- [ ] Add comprehensive test suite for import resolution

### Phase 2: VS Code Extension Foundation (v0.3.x)
- [ ] Set up Language Server Protocol implementation
- [ ] Implement basic diagnostic provider
- [ ] Add import completion provider
- [ ] Create package registry integration
- [ ] Add local fragment discovery

### Phase 3: Advanced IntelliSense (v0.4.0)
- [ ] Component parameter completion
- [ ] Hover information for imports and components
- [ ] Go-to-definition for fragment imports
- [ ] Quick fixes for import errors
- [ ] Fragment dependency visualization

### Phase 4: Advanced Features (v0.4.x+)
- [ ] Refactoring support (rename imports, move files)
- [ ] Fragment template generation
- [ ] Package version management
- [ ] Workspace-wide fragment analysis
- [ ] Performance optimization and caching

## Benefits for Developer Experience

### Immediate Feedback
- **Real-time Error Detection**: Import errors shown immediately as you type
- **Intelligent Completion**: Automatic suggestions for available packages and fragments
- **Quick Fixes**: One-click solutions for common import problems

### Enhanced Productivity
- **Package Discovery**: Explore available official and community packages
- **Component Documentation**: Hover to see component parameters and usage
- **Dependency Tracking**: Understand fragment dependencies and relationships

### Quality Assurance
- **Import Validation**: Ensure all imports are resolvable before runtime
- **Version Compatibility**: Warn about version mismatches and conflicts
- **Best Practices**: Suggest optimal import patterns and package usage

This architecture ensures that the VS Code extension will provide a world-class development experience while leveraging Markout's existing robust error handling and diagnostic infrastructure.