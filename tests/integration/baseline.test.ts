import * as acorn from 'acorn';
import { generate } from 'escodegen';
import fs from 'fs';
import path from 'path';
import { assert, describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/compiler';
import { BaseContext } from '../../src/runtime/base/base-context';
import {
  cleanupScopes,
  normalizeLineEndings,
  normalizeTextForComparison,
} from '../util';

const baselineDir = path.join(__dirname, 'baseline');

describe('baseline examples', () => {
  // Skip if baseline directory doesn't exist
  if (!fs.existsSync(baselineDir)) {
    it('should skip tests when baseline directory does not exist', () => {
      console.log('Skipping baseline tests - directory not found');
      expect(true).toBe(true);
    });
    return;
  }

  const compiler = new Compiler({ docroot: baselineDir });

  fs.readdirSync(baselineDir).forEach(file => {
    if (
      fs.statSync(path.join(baselineDir, file)).isFile() &&
      file.endsWith('-in.html')
    ) {
      const testName = file.replace('-in.html', '');

      it(`${testName} - should compile successfully`, async () => {
        const page = await compiler.compile(file);
        const source = page.source;

        // Check if expected errors exist
        const expectedErrorsPath = path.join(
          baselineDir,
          file.replace('-in.html', '-err.json')
        );
        if (fs.existsSync(expectedErrorsPath)) {
          const expectedErrors = JSON.parse(
            await fs.promises.readFile(expectedErrorsPath, 'utf8')
          );
          const actualErrors = JSON.parse(JSON.stringify(source.errors));
          assert.deepEqual(
            actualErrors,
            expectedErrors,
            `Errors don't match expected for ${file}`
          );
          return; // Skip further checks if we expected errors
        }

        // Check for unexpected compilation errors
        if (source.errors.length > 0) {
          throw new Error(
            `Compilation failed for ${file}: ${source.errors.map(e => e.msg).join(', ')}`
          );
        }

        // Verify code generation
        expect(page.code).toBeDefined();
        expect(page.code!.expression).toBeDefined();

        // Check if expected JS output exists and matches
        const expectedJsPath = path.join(
          baselineDir,
          file.replace('-in.html', '-out.js')
        );
        if (fs.existsSync(expectedJsPath)) {
          const actualJs = generate(page.code!.expression);
          const expectedJs = await fs.promises.readFile(expectedJsPath, {
            encoding: 'utf8',
          });

          // Parse both to AST for structural comparison (ignoring whitespace differences)
          const actualAst = acorn.parse(`(${actualJs})`, { ecmaVersion: 2020 });
          const expectedAst = acorn.parse(expectedJs, { ecmaVersion: 2020 });

          assert.deepEqual(
            actualAst,
            expectedAst,
            `Generated JS doesn't match expected output for ${file}`
          );
        }

        // Check if expected HTML output exists and matches
        const expectedHtmlPath = path.join(
          baselineDir,
          file.replace('-in.html', '-out.html')
        );
        if (fs.existsSync(expectedHtmlPath)) {
          const actualHTML = source.doc.toString() + '\n';
          const expectedHTML = await fs.promises.readFile(expectedHtmlPath, {
            encoding: 'utf8',
          });
          assert.equal(
            normalizeTextForComparison(actualHTML),
            normalizeTextForComparison(expectedHTML),
            `Generated HTML doesn't match expected output for ${file}`
          );
        }
      });

      it(`${testName} - should execute correctly in runtime`, async () => {
        const page = await compiler.compile(file);
        const source = page.source;

        // Skip if compilation failed or expected to fail
        const expectedErrorsPath = path.join(
          baselineDir,
          file.replace('-in.html', '-err.json')
        );
        if (
          source.errors.length > 0 ||
          !page.code ||
          fs.existsSync(expectedErrorsPath)
        ) {
          return;
        }

        const jsCode = generate(page.code.expression);
        const scopeProps = eval(`(${jsCode})`);

        // Create runtime context and instantiate scope
        const context = new BaseContext({ root: scopeProps }, {}).refresh();
        const rootScope = context.root;

        // Basic runtime structure verification
        expect(rootScope).toBeDefined();
        expect(rootScope.props.name).toBe('page');

        // Check if expected runtime behavior exists
        const expectedBehaviorPath = path.join(
          baselineDir,
          file.replace('-in.html', '-behavior.js')
        );
        if (fs.existsSync(expectedBehaviorPath)) {
          // Load and execute behavior test
          const behaviorTest = await fs.promises.readFile(
            expectedBehaviorPath,
            { encoding: 'utf8' }
          );
          const testFunction = eval(`(${behaviorTest})`);

          // Execute behavior test with context and scope
          await testFunction(context, rootScope);
        }
      });
    }
  });
});
