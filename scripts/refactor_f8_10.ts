import { Project, SyntaxKind, ArrowFunction, Block, TryStatement } from "ts-morph";
const project = new Project();
const sourceFile = project.addSourceFileAtPath("server_food_analyze_run.ts");
const func = sourceFile.getFunctionOrThrow("runFoodAnalyze");

let targetArrow: ArrowFunction | null = null;
func.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
  if (call.getExpression().getText() === "streamDebugLogStorage.run") {
    targetArrow = call.getArguments()[1].asKind(SyntaxKind.ArrowFunction) || null;
  }
});

if (targetArrow) {
  const tryStmts = targetArrow.getDescendantsOfKind(SyntaxKind.TryStatement);
  if (tryStmts.length > 0) {
    const tryBlock = tryStmts[0].getTryBlock();
    const locals = new Set<string>();
    for (const stmt of tryBlock.getStatements()) {
      if (stmt.getKind() === SyntaxKind.VariableStatement) {
        const decList = stmt.getFirstChildByKind(SyntaxKind.VariableDeclarationList);
        if (decList) {
          for (const dec of decList.getDeclarations()) {
            locals.add(dec.getName());
          }
        }
      }
    }
    console.log("Locals in try block:", Array.from(locals));
  }
}
