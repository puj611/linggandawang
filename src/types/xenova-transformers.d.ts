// Type declarations for @xenova/transformers
// This module is used at runtime but doesn't have proper TypeScript types

declare module '@xenova/transformers' {
  export interface PipelineOptions {
    quantized?: boolean;
  }

  export interface FeatureExtractionOutput {
    data: Float32Array;
    dims: number[];
  }

  export type PipelineTask = 'feature-extraction' | 'text-classification' | 'token-classification';

  export interface PipelineFunction {
    (input: string, options?: Record<string, unknown>): Promise<FeatureExtractionOutput>;
  }

  export function pipeline(
    task: PipelineTask,
    model: string,
    options?: PipelineOptions,
  ): Promise<PipelineFunction>;
}
