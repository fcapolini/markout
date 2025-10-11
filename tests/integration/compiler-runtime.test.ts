import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/compiler';
import { BaseContext } from '../../src/runtime/base/base-context';
import { generate } from 'escodegen';
import { parse } from '../../src/html/parser';

describe('compiler-runtime integration', () => {
  it('should execute a simple compiled HTML with reactive values', () => {
    const html = `<html><body><div :count="0">Count: \${count}</div></body></html>`;

    // Parse and compile the HTML
    const source = parse(html, 'test.html');
    const compiled = Compiler.compilePage({ source });
    
    if (!compiled.code) {
      throw new Error(`Compilation failed: ${compiled.source.errors.map(e => e.msg).join(', ')}`);
    }
    
    const jsCode = generate(compiled.code.expression);
    
    // Execute the generated code to get the scope props
    const scopeProps = eval(`(${jsCode})`);
    
    // Create a runtime context and instantiate the scope
    const context = new BaseContext({ root: scopeProps }, {});
    const rootScope = context.root;
    
    // Verify the structure exists
    expect(rootScope).toBeDefined();
    expect(rootScope.children).toBeDefined();
    expect(rootScope.children.length).toBeGreaterThan(0);
    
    // Root scope is now the page scope directly
    expect(rootScope.props.name).toBe('page');
    
    const bodyScope = rootScope.children.find((child: any) => child.props.name === 'body');
    expect(bodyScope).toBeDefined();
    
    if (bodyScope) {
      // Find the div scope which should have the count value
      const divScope = bodyScope.children[0];
      expect(divScope).toBeDefined();
      expect(divScope.values.count).toBeDefined();
      
      // Test that the reactive value works
      const countValue = divScope.values.count;
      expect(countValue.get()).toBe('0'); // HTML attributes are strings
      
      // Update the value and verify reactivity
      countValue.set(5);
      expect(countValue.get()).toBe(5);
    }
  });

  it('should handle multiple reactive values', () => {
    const html = `<html><body><div :x="10" :y="20">Values</div></body></html>`;

    // Parse and compile the HTML
    const source = parse(html, 'test.html');
    const compiled = Compiler.compilePage({ source });
    
    if (!compiled.code) {
      throw new Error(`Compilation failed: ${compiled.source.errors.map(e => e.msg).join(', ')}`);
    }
    
    const jsCode = generate(compiled.code.expression);
    
    // Execute the generated code to get the scope props
    const scopeProps = eval(`(${jsCode})`);
    
    // Create a runtime context and instantiate the scope
    const context = new BaseContext({ root: scopeProps }, {});
    const rootScope = context.root;
    
    // Navigate to the div scope - root is now the page scope
    const bodyScope = rootScope.children.find((child: any) => child.props.name === 'body');
    
    if (bodyScope) {
      const divScope = bodyScope.children[0];
      
      // Test multiple reactive values
      const xValue = divScope.values.x;
      const yValue = divScope.values.y;
      
      expect(xValue.get()).toBe('10');
      expect(yValue.get()).toBe('20');
      
      // Update values independently
      xValue.set(100);
      yValue.set(200);
      
      expect(xValue.get()).toBe(100);
      expect(yValue.get()).toBe(200);
    }
  });
});