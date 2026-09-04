export interface FoodAnalyzeContext {
  req: any;
  res: any;
  isStream: boolean;
  sendStreamEvent: (data: any) => void;
  // We can fill this out
}
