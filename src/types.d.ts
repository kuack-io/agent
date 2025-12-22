// WebGPU API types
interface GPUAdapter {
  readonly features: GPUSupportedFeatures;
  readonly limits: GPUSupportedLimits;
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
}

interface GPUDevice extends EventTarget {
  readonly features: GPUSupportedFeatures;
  readonly limits: GPUSupportedLimits;
  readonly queue: GPUQueue;
  destroy(): void;
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
  createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
  createSampler(descriptor?: GPUSamplerDescriptor): GPUSampler;
  createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
  createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
  createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
  createComputePipeline(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline;
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
  createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
  createRenderBundleEncoder(descriptor: GPURenderBundleEncoderDescriptor): GPURenderBundleEncoder;
  createQuerySet(descriptor: GPUQuerySetDescriptor): GPUQuerySet;
  pushErrorScope(filter: GPUErrorFilter): void;
  popErrorScope(): Promise<GPUError | null>;
  uncapturederror: Event | null;
}

interface GPUQueue {
  submit(commandBuffers: GPUCommandBuffer[]): void;
  onSubmittedWorkDone(): Promise<undefined>;
  writeBuffer(
    buffer: GPUBuffer,
    bufferOffset: number,
    data: BufferSource | ArrayBuffer,
    dataOffset?: number,
    size?: number,
  ): void;
  writeTexture(
    destination: GPUImageCopyTexture,
    data: ImageData | ArrayBufferView | ImageBitmap,
    dataLayout: GPUImageDataLayout,
    size: GPUExtent3D,
  ): void;
  copyExternalImageToTexture(
    source: GPUImageCopyExternalImage,
    destination: GPUImageCopyTextureTagged,
    copySize: GPUExtent3D,
  ): void;
}

interface GPUBuffer {
  readonly size: number;
  readonly usage: number;
  mapAsync(mode: GPUMapModeFlags, offset?: number, size?: number): Promise<undefined>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

interface GPUTexture {
  readonly width: number;
  readonly height: number;
  readonly depthOrArrayLayers: number;
  readonly mipLevelCount: number;
  readonly sampleCount: number;
  readonly dimension: GPUTextureDimension;
  readonly format: GPUTextureFormat;
  readonly usage: number;
  createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView;
  destroy(): void;
}

interface GPUTextureView {
  readonly format: GPUTextureFormat;
  readonly dimension: GPUTextureViewDimension;
  readonly aspect: GPUTextureAspect;
  readonly baseMipLevel: number;
  readonly mipLevelCount: number;
  readonly baseArrayLayer: number;
  readonly arrayLayerCount: number;
}

interface GPUSampler {
  label: string;
}

interface GPUBindGroupLayout {
  label: string;
}

interface GPUPipelineLayout {
  label: string;
}

interface GPUBindGroup {
  label: string;
}

interface GPUShaderModule {
  label: string;
  compilationInfo(): Promise<GPUCompilationInfo>;
}

interface GPUCompilationInfo {
  readonly messages: ReadonlyArray<GPUCompilationMessage>;
}

interface GPUCompilationMessage {
  readonly message: string;
  readonly type: GPUCompilationMessageType;
  readonly lineNum: number;
  readonly linePos: number;
  readonly offset: number;
  readonly length: number;
}

type GPUCompilationMessageType = "error" | "warning" | "info";

interface GPUComputePipeline {
  readonly id: number;
  label: string;
  getBindGroupLayout(index: number): GPUBindGroupLayout;
}

interface GPURenderPipeline {
  readonly id: number;
  label: string;
  getBindGroupLayout(index: number): GPUBindGroupLayout;
}

interface GPUCommandEncoder {
  readonly device: GPUDevice;
  label: string;
  beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
  beginComputePass(descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder;
  copyBufferToBuffer(
    source: GPUBuffer,
    sourceOffset: number,
    destination: GPUBuffer,
    destinationOffset: number,
    size: number,
  ): void;
  copyBufferToTexture(source: GPUImageCopyBuffer, destination: GPUImageCopyTexture, copySize: GPUExtent3D): void;
  copyTextureToBuffer(source: GPUImageCopyTexture, destination: GPUImageCopyBuffer, copySize: GPUExtent3D): void;
  copyTextureToTexture(source: GPUImageCopyTexture, destination: GPUImageCopyTexture, copySize: GPUExtent3D): void;
  clearBuffer(buffer: GPUBuffer, offset?: number, size?: number): void;
  insertDebugMarker(markerLabel: string): void;
  pushDebugGroup(groupLabel: string): void;
  popDebugGroup(): void;
  finish(descriptor?: GPUCommandBufferDescriptor): GPUCommandBuffer;
}

interface GPUComputePassEncoder {
  readonly device: GPUDevice;
  label: string;
  setPipeline(pipeline: GPUComputePipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup | null, dynamicOffsets?: number[]): void;
  setBindGroup(
    index: number,
    bindGroup: GPUBindGroup | null,
    dynamicOffsetsData: Uint32Array,
    dynamicOffsetsDataStart: number,
    dynamicOffsetsDataLength: number,
  ): void;
  dispatchWorkgroups(workgroupCountX: number, workgroupCountY?: number, workgroupCountZ?: number): void;
  dispatchWorkgroupsIndirect(indirectBuffer: GPUBuffer, indirectOffset: number): void;
  beginPipelineStatisticsQuery(querySet: GPUQuerySet, queryIndex: number): void;
  endPipelineStatisticsQuery(): void;
  writeTimestamp(querySet: GPUQuerySet, queryIndex: number): void;
  insertDebugMarker(markerLabel: string): void;
  pushDebugGroup(groupLabel: string): void;
  popDebugGroup(): void;
  end(): void;
}

interface GPURenderPassEncoder {
  readonly device: GPUDevice;
  label: string;
  setViewport(x: number, y: number, width: number, height: number, minDepth: number, maxDepth: number): void;
  setScissorRect(x: number, y: number, width: number, height: number): void;
  setBlendConstant(color: GPUColor): void;
  setStencilReference(reference: number): void;
  beginOcclusionQuery(queryIndex: number): void;
  endOcclusionQuery(): void;
  executeBundles(bundles: GPURenderBundle[]): void;
  end(): void;
  setPipeline(pipeline: GPURenderPipeline): void;
  setIndexBuffer(buffer: GPUBuffer, indexFormat: GPUIndexFormat, offset?: number, size?: number): void;
  setVertexBuffer(slot: number, buffer: GPUBuffer | null, offset?: number, size?: number): void;
  draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
  drawIndexed(
    indexCount: number,
    instanceCount?: number,
    firstIndex?: number,
    baseVertex?: number,
    firstInstance?: number,
  ): void;
  drawIndirect(indirectBuffer: GPUBuffer, indirectOffset: number): void;
  drawIndexedIndirect(indirectBuffer: GPUBuffer, indirectOffset: number): void;
  writeTimestamp(querySet: GPUQuerySet, queryIndex: number): void;
  insertDebugMarker(markerLabel: string): void;
  pushDebugGroup(groupLabel: string): void;
  popDebugGroup(): void;
}

interface GPURenderBundleEncoder {
  readonly device: GPUDevice;
  label: string;
  finish(descriptor?: GPURenderBundleDescriptor): GPURenderBundle;
  setPipeline(pipeline: GPURenderPipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup | null, dynamicOffsets?: number[]): void;
  setBindGroup(
    index: number,
    bindGroup: GPUBindGroup | null,
    dynamicOffsetsData: Uint32Array,
    dynamicOffsetsDataStart: number,
    dynamicOffsetsDataLength: number,
  ): void;
  setIndexBuffer(buffer: GPUBuffer, indexFormat: GPUIndexFormat, offset?: number, size?: number): void;
  setVertexBuffer(slot: number, buffer: GPUBuffer | null, offset?: number, size?: number): void;
  draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
  drawIndexed(
    indexCount: number,
    instanceCount?: number,
    firstIndex?: number,
    baseVertex?: number,
    firstInstance?: number,
  ): void;
  drawIndirect(indirectBuffer: GPUBuffer, indirectOffset: number): void;
  drawIndexedIndirect(indirectBuffer: GPUBuffer, indirectOffset: number): void;
  insertDebugMarker(markerLabel: string): void;
  pushDebugGroup(groupLabel: string): void;
  popDebugGroup(): void;
}

interface GPURenderBundle {
  readonly id: number;
  label: string;
}

interface GPUCommandBuffer {
  readonly id: number;
  label: string;
}

interface GPUQuerySet {
  readonly type: GPUQueryType;
  readonly count: number;
  destroy(): void;
}

interface GPUError {
  readonly message: string;
}

type GPUErrorFilter = "out-of-memory" | "validation";

type GPUMapModeFlags = number;

type GPUTextureDimension = "1d" | "2d" | "3d";

type GPUTextureFormat = string;

type GPUTextureViewDimension = "1d" | "2d" | "2d-array" | "cube" | "cube-array" | "3d";

type GPUTextureAspect = "all" | "stencil-only" | "depth-only";

type GPUIndexFormat = "uint16" | "uint32";

type GPUQueryType = "occlusion" | "pipeline-statistics" | "timestamp";

type GPUSupportedFeatures = ReadonlySet<string>;

interface GPUSupportedLimits {
  readonly maxTextureDimension1D: number;
  readonly maxTextureDimension2D: number;
  readonly maxTextureDimension3D: number;
  readonly maxTextureArrayLayers: number;
  readonly maxBindGroups: number;
  readonly maxDynamicUniformBuffersPerPipelineLayout: number;
  readonly maxDynamicStorageBuffersPerPipelineLayout: number;
  readonly maxSampledTexturesPerShaderStage: number;
  readonly maxSamplersPerShaderStage: number;
  readonly maxStorageTexturesPerShaderStage: number;
  readonly maxStorageBuffersPerShaderStage: number;
  readonly maxStorageBufferBindingSize: number;
  readonly maxUniformBufferBindingSize: number;
  readonly minUniformBufferOffsetAlignment: number;
  readonly minStorageBufferOffsetAlignment: number;
  readonly maxVertexBuffers: number;
  readonly maxVertexAttributes: number;
  readonly maxVertexBufferArrayStride: number;
  readonly maxInterStageShaderVariables: number;
  readonly maxInterStageShaderComponents: number;
  readonly maxColorAttachments: number;
  readonly maxComputeWorkgroupStorageSize: number;
  readonly maxComputeInvocationsPerWorkgroup: number;
  readonly maxComputeWorkgroupSizeX: number;
  readonly maxComputeWorkgroupSizeY: number;
  readonly maxComputeWorkgroupSizeZ: number;
  readonly maxComputeWorkgroupsPerDimension: number;
}

interface GPUDeviceDescriptor {
  label?: string;
  requiredFeatures?: string[];
  requiredLimits?: Record<string, number>;
}

interface GPUBufferDescriptor {
  label?: string;
  size: number;
  usage: number;
  mappedAtCreation?: boolean;
}

interface GPUTextureDescriptor {
  label?: string;
  size: GPUExtent3D;
  mipLevelCount?: number;
  sampleCount?: number;
  dimension?: GPUTextureDimension;
  format: GPUTextureFormat;
  usage: number;
}

interface GPUTextureViewDescriptor {
  label?: string;
  format?: GPUTextureFormat;
  dimension?: GPUTextureViewDimension;
  aspect?: GPUTextureAspect;
  baseMipLevel?: number;
  mipLevelCount?: number;
  baseArrayLayer?: number;
  arrayLayerCount?: number;
}

interface GPUSamplerDescriptor {
  label?: string;
  addressModeU?: GPUAddressMode;
  addressModeV?: GPUAddressMode;
  addressModeW?: GPUAddressMode;
  magFilter?: GPUFilterMode;
  minFilter?: GPUFilterMode;
  mipmapFilter?: GPUMipmapFilterMode;
  lodMinClamp?: number;
  lodMaxClamp?: number;
  compare?: GPUCompareFunction;
  maxAnisotropy?: number;
}

type GPUAddressMode = "clamp-to-edge" | "repeat" | "mirror-repeat";

type GPUFilterMode = "nearest" | "linear";

type GPUMipmapFilterMode = "nearest" | "linear";

type GPUCompareFunction =
  | "never"
  | "less"
  | "equal"
  | "less-equal"
  | "greater"
  | "not-equal"
  | "greater-equal"
  | "always";

interface GPUBindGroupLayoutDescriptor {
  label?: string;
  entries: GPUBindGroupLayoutEntry[];
}

interface GPUBindGroupLayoutEntry {
  binding: number;
  visibility: number;
  buffer?: GPUBufferBindingLayout;
  sampler?: GPUSamplerBindingLayout;
  texture?: GPUTextureBindingLayout;
  storageTexture?: GPUStorageTextureBindingLayout;
}

interface GPUBufferBindingLayout {
  type?: GPUBufferBindingType;
  hasDynamicOffset?: boolean;
  minBindingSize?: number;
}

type GPUBufferBindingType = "uniform" | "storage" | "read-only-storage";

interface GPUSamplerBindingLayout {
  type?: GPUSamplerBindingType;
}

type GPUSamplerBindingType = "filtering" | "non-filtering" | "comparison";

interface GPUTextureBindingLayout {
  sampleType?: GPUTextureSampleType;
  viewDimension?: GPUTextureViewDimension;
  multisampled?: boolean;
}

type GPUTextureSampleType = "float" | "unfilterable-float" | "depth" | "sint" | "uint";

interface GPUStorageTextureBindingLayout {
  access?: GPUStorageTextureAccess;
  format: GPUTextureFormat;
  viewDimension?: GPUTextureViewDimension;
}

type GPUStorageTextureAccess = "write-only" | "read-only" | "read-write";

interface GPUPipelineLayoutDescriptor {
  label?: string;
  bindGroupLayouts: GPUBindGroupLayout[];
}

interface GPUBindGroupDescriptor {
  label?: string;
  layout: GPUBindGroupLayout;
  entries: GPUBindGroupEntry[];
}

interface GPUBindGroupEntry {
  binding: number;
  resource: GPUBindingResource;
}

type GPUBindingResource = GPUSampler | GPUTextureView | GPUBufferBinding;

interface GPUBufferBinding {
  buffer: GPUBuffer;
  offset?: number;
  size?: number;
}

interface GPUShaderModuleDescriptor {
  label?: string;
  code: string;
  sourceMap?: object;
}

interface GPUProgrammableStage {
  module: GPUShaderModule;
  entryPoint: string;
  constants?: Record<string, number>;
}

interface GPUComputePipelineDescriptor {
  label?: string;
  layout?: GPUPipelineLayout | string;
  compute: GPUProgrammableStage;
}

interface GPURenderPipelineDescriptor {
  label?: string;
  layout?: GPUPipelineLayout | string;
  vertex: GPUVertexState;
  primitive?: GPUPrimitiveState;
  depthStencil?: GPUDepthStencilState;
  multisample?: GPUMultisampleState;
  fragment?: GPUFragmentState;
}

interface GPUVertexState extends GPUProgrammableStage {
  buffers?: GPUVertexBufferLayout[];
}

interface GPUVertexBufferLayout {
  arrayStride: number;
  stepMode?: GPUVertexStepMode;
  attributes: GPUVertexAttribute[];
}

type GPUVertexStepMode = "vertex" | "instance";

interface GPUVertexAttribute {
  format: GPUVertexFormat;
  offset: number;
  shaderLocation: number;
}

type GPUVertexFormat =
  | "uint8x2"
  | "uint8x4"
  | "sint8x2"
  | "sint8x4"
  | "unorm8x2"
  | "unorm8x4"
  | "snorm8x2"
  | "snorm8x4"
  | "uint16x2"
  | "uint16x4"
  | "sint16x2"
  | "sint16x4"
  | "unorm16x2"
  | "unorm16x4"
  | "snorm16x2"
  | "snorm16x4"
  | "float16x2"
  | "float16x4"
  | "float32"
  | "float32x2"
  | "float32x3"
  | "float32x4"
  | "uint32"
  | "uint32x2"
  | "uint32x3"
  | "uint32x4"
  | "sint32"
  | "sint32x2"
  | "sint32x3"
  | "sint32x4";

interface GPUPrimitiveState {
  topology?: GPUPrimitiveTopology;
  stripIndexFormat?: GPUIndexFormat;
  cullMode?: GPUCullMode;
  frontFace?: GPUFrontFace;
  unclippedDepth?: boolean;
}

type GPUPrimitiveTopology = "point-list" | "line-list" | "line-strip" | "triangle-list" | "triangle-strip";

type GPUCullMode = "none" | "front" | "back";

type GPUFrontFace = "ccw" | "cw";

interface GPUDepthStencilState {
  format: GPUTextureFormat;
  depthWriteEnabled?: boolean;
  depthCompare?: GPUCompareFunction;
  stencilFront?: GPUStencilFaceState;
  stencilBack?: GPUStencilFaceState;
  stencilReadMask?: number;
  stencilWriteMask?: number;
  depthBias?: number;
  depthBiasSlopeScale?: number;
  depthBiasClamp?: number;
}

interface GPUStencilFaceState {
  compare?: GPUCompareFunction;
  failOp?: GPUStencilOperation;
  depthFailOp?: GPUStencilOperation;
  passOp?: GPUStencilOperation;
}

type GPUStencilOperation =
  | "keep"
  | "zero"
  | "replace"
  | "invert"
  | "increment-clamp"
  | "decrement-clamp"
  | "increment-wrap"
  | "decrement-wrap";

interface GPUMultisampleState {
  count?: number;
  mask?: number;
  alphaToCoverageEnabled?: boolean;
}

interface GPUFragmentState extends GPUProgrammableStage {
  targets: GPUColorTargetState[];
}

interface GPUColorTargetState {
  format: GPUTextureFormat;
  blend?: GPUBlendState;
  writeMask?: number;
}

interface GPUBlendState {
  color?: GPUBlendComponent;
  alpha?: GPUBlendComponent;
}

interface GPUBlendComponent {
  operation?: GPUBlendOperation;
  srcFactor?: GPUBlendFactor;
  dstFactor?: GPUBlendFactor;
}

type GPUBlendOperation = "add" | "subtract" | "reverse-subtract" | "min" | "max";

type GPUBlendFactor =
  | "zero"
  | "one"
  | "src"
  | "one-minus-src"
  | "src-alpha"
  | "one-minus-src-alpha"
  | "dst"
  | "one-minus-dst"
  | "dst-alpha"
  | "one-minus-dst-alpha"
  | "src-alpha-saturated"
  | "constant"
  | "one-minus-constant";

interface GPURenderPassDescriptor {
  label?: string;
  colorAttachments: GPURenderPassColorAttachment[];
  depthStencilAttachment?: GPURenderPassDepthStencilAttachment;
  occlusionQuerySet?: GPUQuerySet;
  timestampWrites?: GPURenderPassTimestampWrites;
  maxDrawCount?: number;
}

interface GPURenderPassColorAttachment {
  view: GPUTextureView;
  resolveTarget?: GPUTextureView;
  clearValue?: GPUColor;
  loadOp: GPULoadOp;
  storeOp: GPUStoreOp;
}

interface GPURenderPassDepthStencilAttachment {
  view: GPUTextureView;
  depthClearValue?: number;
  depthLoadOp?: GPULoadOp;
  depthStoreOp?: GPUStoreOp;
  depthReadOnly?: boolean;
  stencilClearValue?: number;
  stencilLoadOp?: GPULoadOp;
  stencilStoreOp?: GPUStoreOp;
  stencilReadOnly?: boolean;
}

type GPULoadOp = "load" | "clear";

type GPUStoreOp = "store" | "discard";

interface GPURenderPassTimestampWrites {
  querySet: GPUQuerySet;
  beginningOfPassWriteIndex?: number;
  endOfPassWriteIndex?: number;
}

interface GPUComputePassDescriptor {
  label?: string;
  timestampWrites?: GPUComputePassTimestampWrites;
}

interface GPUComputePassTimestampWrites {
  querySet: GPUQuerySet;
  beginningOfPassWriteIndex?: number;
  endOfPassWriteIndex?: number;
}

interface GPUCommandEncoderDescriptor {
  label?: string;
}

interface GPUCommandBufferDescriptor {
  label?: string;
}

interface GPURenderBundleEncoderDescriptor {
  label?: string;
  colorFormats: GPUTextureFormat[];
  depthStencilFormat?: GPUTextureFormat;
  sampleCount?: number;
  depthReadOnly?: boolean;
  stencilReadOnly?: boolean;
}

interface GPURenderBundleDescriptor {
  label?: string;
}

interface GPUQuerySetDescriptor {
  label?: string;
  type: GPUQueryType;
  count: number;
  pipelineStatistics?: string[];
}

interface GPUImageCopyBuffer {
  buffer: GPUBuffer;
  layout: GPUImageDataLayout;
}

interface GPUImageCopyTexture {
  texture: GPUTexture;
  mipLevel?: number;
  origin?: GPUOrigin3D;
  aspect?: GPUTextureAspect;
}

interface GPUImageCopyTextureTagged extends GPUImageCopyTexture {
  colorSpace?: PredefinedColorSpace;
  premultipliedAlpha?: boolean;
}

interface GPUImageCopyExternalImage {
  source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
  origin?: GPUOrigin2D;
  colorSpace?: PredefinedColorSpace;
  premultipliedAlpha?: boolean;
}

interface GPUImageDataLayout {
  offset?: number;
  bytesPerRow?: number;
  rowsPerImage?: number;
}

type GPUExtent3D = [number, number, number] | { width: number; height?: number; depthOrArrayLayers?: number };

type GPUOrigin2D = [number, number] | { x?: number; y?: number };

type GPUOrigin3D = [number, number, number] | { x?: number; y?: number; z?: number };

type GPUColor = [number, number, number, number] | { r: number; g: number; b: number; a: number };

interface Navigator {
  gpu?: GPU;
}

interface GPU {
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
}

interface GPURequestAdapterOptions {
  powerPreference?: GPUPowerPreference;
  forceFallbackAdapter?: boolean;
}

type GPUPowerPreference = "low-power" | "high-performance";
