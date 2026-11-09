// PRD §8 story end to end = acceptance test (P11, S-11.1..S-11.9).
// Exits non-zero on any unexpected state. Total duration must be < 6 minutes.
import { fileURLToPath } from "node:url";

import { createDemoContext } from "./demo/context.js";
import { step1 } from "./demo/step1.js";
import { step2 } from "./demo/step2.js";
import { step3 } from "./demo/step3.js";
import { step4 } from "./demo/step4.js";
import { step5 } from "./demo/step5.js";
import { step6 } from "./demo/step6.js";
import { step7 } from "./demo/step7.js";
import { step8 } from "./demo/step8.js";
import { fail } from "./lib/log.js";

export async function runDemo(): Promise<number> {
  const startTime = Date.now();
  console.log("============================================================");
  console.log("  SEALED TIP — ACCEPTANCE TEST RUN (PRD §8 Demo Story)     ");
  console.log("============================================================");

  try {
    const ctx = await createDemoContext();

    await step1(ctx);
    await step2(ctx);
    await step3(ctx);
    await step4(ctx);
    await step5(ctx);
    await step6(ctx);
    await step7(ctx);
    await step8(ctx);

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("\n============================================================");
    console.log(`🎉 ALL 8 ACCEPTANCE STEPS PASSED SUCCESSFULLY!`);
    console.log(`⏱ Total elapsed time: ${elapsedSeconds} s (target: < 360 s)`);
    console.log("============================================================");

    if (Number(elapsedSeconds) >= 360) {
      fail(`Demo took ${elapsedSeconds}s, exceeding maximum allowed 360s (6 minutes)`);
    }

    return 0;
  } catch (err) {
    fail(`Demo failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runDemo().then((code) => {
    if (code !== 0) process.exit(code);
  });
}
