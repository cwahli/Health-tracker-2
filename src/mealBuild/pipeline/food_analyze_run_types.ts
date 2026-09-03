export interface PipelineRunContext {
  req: any;
  res: any;
  isStream: boolean;
  hasSentHeaders: boolean;
  sessionId: string;
  initialLogCount: number;
}
