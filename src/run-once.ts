/**
 * Tek seferlik otomasyon koşusu — sunucuyu açmadan çalışır ve kapanır.
 * Windows Görev Zamanlayıcı bu dosyayı çağırır (bkz. OTOMASYON.bat).
 */
import { warnIfIncompleteConfig } from './config.ts';
import { runHistory, runTask, TASKS, type TaskName } from './services/automation.ts';

const warnings = warnIfIncompleteConfig();
for (const warning of warnings) console.warn(`[uyari] ${warning}`);

if (warnings.length > 0) {
  console.error('\nEksik yapılandırma — görevler atlandı.\n');
  process.exit(1);
}

let failed = 0;

for (const task of Object.keys(TASKS) as TaskName[]) {
  const outcome = await runTask(task);
  const icon = outcome.status === 'ok' ? 'OK  ' : outcome.status === 'skipped' ? 'ATLA' : 'HATA';
  console.log(`${icon} ${task.padEnd(18)} ${outcome.message}`);
  if (outcome.status === 'error') failed++;
}

const recent = runHistory(undefined, 4);
console.log('\nSon koşular:');
for (const run of recent) {
  console.log(`  ${run.startedAt}  ${run.task.padEnd(18)} ${run.status.padEnd(8)} ${run.message}`);
}

process.exit(failed > 0 ? 1 : 0);
