import { generate } from 'escodegen';
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/compiler';
import { parse } from '../../src/html/parser';
import { BaseContext } from '../../src/runtime/base/base-context';
import { BaseGlobal } from '../../src/runtime/base/base-global';

describe.skip('falsy values rendering', () => {
  it('should render the number 0', () => {
    const html = `<html><body><div :v=\${0}>Welcome '\${v}'</div></body></html>`;

    // Parse and compile the HTML
    const source = parse(html, 'test.html');
    const global = new BaseGlobal(new BaseContext({ root: { id: '-' } }));
    const compiled = Compiler.compilePage({ source }, global);

    if (!compiled.code) {
      throw new Error(
        `Compilation failed: ${compiled.source.errors.map(e => e.msg).join(', ')}`
      );
    }

    const jsCode = generate(compiled.code.expression);

    // Execute the generated code to get the scope props
    const scopeProps = eval(`(${jsCode})`);

    // Create a runtime context and instantiate the scope
    const context = new BaseContext({ root: scopeProps }, {}).refresh();
    const rootScope = context.root;

    // Navigate to the div scope - root -> body -> div
    const bodyScope = rootScope.children.find(
      (child: any) => child.props.name === 'body'
    );

    expect(bodyScope).toBeDefined();
    if (!bodyScope) throw new Error('Body scope not found');

    const divScope = bodyScope.children[0];
    expect(divScope).toBeDefined();

    // Check that v is 0
    // expect(divScope.values.v.get()).toBe(0);

    // Check that the text expression evaluates to "Welcome '0'" (not "Welcome ''")
    const textValue = Object.keys(divScope.values).find(key =>
      key.startsWith('text$')
    );

    if (textValue) {
      const renderedText = divScope.values[textValue].get();
      expect(renderedText).toBe("Welcome '0'");
      expect(renderedText).not.toBe("Welcome ''");
    } else {
      throw new Error('No text value found in div scope');
    }
  });

  it('should render false as "false"', () => {
    const html = `<html><body><div :v=\${false}>Value: \${v}</div></body></html>`;

    const source = parse(html, 'test.html');
    const global = new BaseGlobal(new BaseContext({ root: { id: '-' } }));
    const compiled = Compiler.compilePage({ source }, global);

    if (!compiled.code) {
      throw new Error(
        `Compilation failed: ${compiled.source.errors.map(e => e.msg).join(', ')}`
      );
    }

    const jsCode = generate(compiled.code.expression);
    const scopeProps = eval(`(${jsCode})`);
    const context = new BaseContext({ root: scopeProps }, {}).refresh();
    const rootScope = context.root;

    const bodyScope = rootScope.children.find(
      (child: any) => child.props.name === 'body'
    );
    if (!bodyScope) throw new Error('Body scope not found');
    const divScope = bodyScope.children[0];

    expect(divScope.values.v.get()).toBe(false);

    const textValue = Object.keys(divScope.values).find(key =>
      key.startsWith('text$')
    );

    if (textValue) {
      const renderedText = divScope.values[textValue].get();
      expect(renderedText).toBe('Value: false');
    }
  });

  it('should render empty string', () => {
    const html = `<html><body><div :v=\${'""'}>Value: '\${v}'</div></body></html>`;

    const source = parse(html, 'test.html');
    const global = new BaseGlobal(new BaseContext({ root: { id: '-' } }));
    const compiled = Compiler.compilePage({ source }, global);

    if (!compiled.code) {
      throw new Error(
        `Compilation failed: ${compiled.source.errors.map(e => e.msg).join(', ')}`
      );
    }

    const jsCode = generate(compiled.code.expression);
    const scopeProps = eval(`(${jsCode})`);
    const context = new BaseContext({ root: scopeProps }, {}).refresh();
    const rootScope = context.root;

    const bodyScope = rootScope.children.find(
      (child: any) => child.props.name === 'body'
    );
    if (!bodyScope) throw new Error('Body scope not found');
    const divScope = bodyScope.children[0];

    expect(divScope.values.v.get()).toBe('');

    const textValue = Object.keys(divScope.values).find(key =>
      key.startsWith('text$')
    );

    if (textValue) {
      const renderedText = divScope.values[textValue].get();
      expect(renderedText).toBe("Value: ''");
    }
  });

  it('should not render null and undefined', () => {
    const html = `<html><body><div :v=\${null}>Value: \${v}</div></body></html>`;

    const source = parse(html, 'test.html');
    const global = new BaseGlobal(new BaseContext({ root: { id: '-' } }));
    const compiled = Compiler.compilePage({ source }, global);

    if (!compiled.code) {
      throw new Error(
        `Compilation failed: ${compiled.source.errors.map(e => e.msg).join(', ')}`
      );
    }

    const jsCode = generate(compiled.code.expression);
    const scopeProps = eval(`(${jsCode})`);
    const context = new BaseContext({ root: scopeProps }, {}).refresh();
    const rootScope = context.root;

    const bodyScope = rootScope.children.find(
      (child: any) => child.props.name === 'body'
    );
    if (!bodyScope) throw new Error('Body scope not found');
    const divScope = bodyScope.children[0];

    expect(divScope.values.v.get()).toBe(null);

    const textValue = Object.keys(divScope.values).find(key =>
      key.startsWith('text$')
    );

    if (textValue) {
      const renderedText = divScope.values[textValue].get();
      // null and undefined should render as empty string in text interpolation
      expect(renderedText).toBe('Value: ');
    }
  });
});
