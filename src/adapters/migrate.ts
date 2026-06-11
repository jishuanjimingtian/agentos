/**
 * 迁移脚本：从现有 MEMORY.md → AgentOS Semantic Memory
 *
 * 运行: npx ts-node src/adapters/migrate.ts
 * 迁移后旧 MEMORY.md 不会删除，只是作为额外备份
 */
import { MemoryBridge } from './memory-bridge';
import * as path from 'path';

const WORKSPACE = path.resolve(__dirname, '..', '..', '..', '..');
const MEMORY_MD = path.join(WORKSPACE, 'MEMORY.md');

console.log('═══════════════════════════════');
console.log('🧠 MEMORY.md → AgentOS 迁移');
console.log('═══════════════════════════════');
console.log(`Workspace: ${WORKSPACE}`);
console.log(`MEMORY.md: ${MEMORY_MD}`);
console.log('');

const bridge = new MemoryBridge(WORKSPACE);

const result = bridge.migrateFromMemoryMd(MEMORY_MD);
bridge.flush();

console.log(`✅ 迁移完成!`);
console.log(`   导入: ${result.imported} 条`);
console.log(`   跳过: ${result.skipped} 条`);
console.log('');
console.log('📊 迁移后状态:');
console.log(bridge.statusReport());
console.log('');
console.log('💡 MEMORY.md 文件未删除，可手动删除或保留作备份。');
