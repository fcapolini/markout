import { Compiler, CompilerProps } from './compiler';

export interface CompilerServiceProps {
  compilerProps: CompilerProps;
}

export class CompilerService {
  compiler: Compiler;

  constructor(props: CompilerServiceProps) {
    this.compiler = new Compiler(props.compilerProps);
    //TODO
  }
}
