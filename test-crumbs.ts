import { buildDebugMarkdownReport } from './src/utils/debugPayload.ts';
const input = {
  jobId: "123",
  userActionBreadcrumbs: [
    { timestamp: "2026-09-04T16:06:52.779Z", action: "click", target: "button", details: { label: "Log Meal" } },
    { timestamp: "2026-09-04T16:07:33.298Z", action: "submit_initiated", target: "chat_composer", details: { prompt: "soto donut", imageCount: 3 } },
    { timestamp: "2026-09-04T16:06:52.779Z", action: "click", target: "button", details: { label: "Log Meal" } },
    { timestamp: "2026-09-04T16:07:33.298Z", action: "submit_initiated", target: "chat_composer", details: { prompt: "soto donut", imageCount: 3 } }
  ]
};
console.log(buildDebugMarkdownReport(input as any));
