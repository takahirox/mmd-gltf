import { mkdir, writeFile } from 'node:fs/promises';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
/** Small, portable CI artifact: measure the complete single-worker browser run. */
export default class BrowserReport implements Reporter {
  private cases: {title:string;status:string;durationMs:number}[]=[];
  onTestEnd(test:TestCase,result:TestResult) {
    this.cases.push({title:test.titlePath().filter(Boolean).join(' / '),status:result.status,durationMs:result.duration});
  }
  async onEnd(result:FullResult) {
    if (!this.cases.length) return; // Listing tests must not overwrite measured evidence.
    await mkdir('test-results',{recursive:true});
    await writeFile('test-results/browser-summary.json',JSON.stringify({
      environment:{ci:!!process.env.CI,platform:process.platform,node:process.version,workers:1},
      status:result.status,durationMs:result.duration,baselineRun66ApproximateMs:77*60*1000,
      baselineTestCount:79,testCount:this.cases.length,
      reductionFromApproximateBaselinePercent:100*(1-result.duration/(77*60*1000)),
      cases:this.cases,
    },null,2)+'\n');
  }
}
