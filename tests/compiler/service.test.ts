import { describe, it, expect } from 'vitest';
import { CompilerService } from '../../src/compiler/service';

describe('CompilerService', () => {
  it('should create a CompilerService with compiler instance', () => {
    const service = new CompilerService({
      compilerProps: {
        docroot: '/test',
      },
    });

    expect(service).toBeDefined();
    expect(service.compiler).toBeDefined();
    expect(service.compiler.props.docroot).toBe('/test');
    expect(service.compiler.preprocessor).toBeDefined();
  });

  it('should create compiler with different docroot', () => {
    const service = new CompilerService({
      compilerProps: {
        docroot: '/minimal/path',
      },
    });

    expect(service.compiler.props.docroot).toBe('/minimal/path');
    expect(service.compiler.preprocessor).toBeDefined();
  });
});